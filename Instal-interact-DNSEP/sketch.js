let video, hands;
let detections = {};
let handX = 0, handY = 0;
let prevHandX = 0, prevHandY = 0;
let handSpeed = 0;
let smoothedWind = 0;
let autoWind = 0;
let windEnabled = false;
let armsUp = false;
let fallingParticles = [];
let t = 0;
let trees = [];
let sceneStartTime;
let windNoiseOffset = 0;
let lastTreeTime = 0;
let nextTreeDelay = 0;


const healthyPalette = [
  [97, 240, 147], [54, 99, 63], [91, 255, 181],
  [66, 158, 98], [53, 125, 78]
];
const sickPalette = [
  [128, 114, 92], [122, 104, 74], [109, 86, 48],
  [73, 54, 21], [55, 37, 7]
];
const flowerPalette = [
  [255, 153, 204], [255, 204, 229], [255, 102, 178],
  [255, 51, 153], [255, 182, 193]
];

function setup() {
  createCanvas(windowWidth * 0.98, windowHeight * 0.98);
  pixelDensity(2);
  colorMode(RGB);
  sceneStartTime = millis();

  video = createCapture(VIDEO);
  video.size(480, 360);
  video.hide();

  hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });
  hands.setOptions({
    maxNumHands: 4, // moins de mains = plus de stabilité
    modelComplexity: 0, // modèle plus rapide (meilleure à distance)
    minDetectionConfidence: 0.3, // plus permissif
    minTrackingConfidence: 0.3
  });
  hands.onResults(gotHands);

  const camera = new Camera(video.elt, {
    onFrame: async () => await hands.send({ image: video.elt }),
    width: 640, height: 480
  });
  camera.start();
}

function draw() {
  if (millis() - sceneStartTime > 600000) {
    trees = [];
    fallingParticles = [];
    sceneStartTime = millis();
  }

  background(230);
  t += 0.015;

  let dx = handX - prevHandX;
  let dy = handY - prevHandY;
  handSpeed = sqrt(dx * dx + dy * dy);
  prevHandX = handX;
  prevHandY = handY;

  let healthyFactor = getOverallHealth();
  autoWind = (noise(windNoiseOffset) - 0.5) * 1.8 * healthyFactor;
  windNoiseOffset += 0.01;

  if (!windEnabled || handSpeed < 5) {
    smoothedWind += (autoWind - smoothedWind) * 0.02;
  } else {
    let targetWind = map(handX, 0, width, -0.5, 0.5);
    smoothedWind += (targetWind - smoothedWind) * 0.1;
  }
  smoothedWind *= 0.9;

  for (let tree of trees) {
    tree.update(smoothedWind, handSpeed, windEnabled, armsUp);
  }
  trees = trees.filter(t => !t.isDead());

    let now = millis();
  if (trees.length < 4 && now - lastTreeTime > nextTreeDelay) {
    trees.push(new Tree(random(100, width - 100), height));
    lastTreeTime = now;
    nextTreeDelay = random(2000, 4000); // 2 to 4 seconds
  }


  for (let tree of trees) {
    tree.draw(smoothedWind, armsUp);
  }

  for (let p of fallingParticles) {
    p.update(smoothedWind);
    p.draw();
  }
  fallingParticles = fallingParticles.filter(p => !p.isDead());
}

function getOverallHealth() {
  if (trees.length === 0) return 1;
  let sum = 0;
  for (let t of trees) sum += 1 - t.deathProgress;
  return constrain(sum / trees.length, 0, 1);
}

function gotHands(results) {
  detections = results;
  if (detections.multiHandLandmarks && detections.multiHandLandmarks.length > 0) {
    let hand = detections.multiHandLandmarks[0];
    handX = hand[9].x * width;
    handY = hand[9].y * height;

    let thumbTip = hand[4], indexTip = hand[8];
    let d = dist(thumbTip.x * width, thumbTip.y * height, indexTip.x * width, indexTip.y * height);
    windEnabled = d > 30; //distance entre les doigt, réduire pour plus loin
    armsUp = handY < height * 0.25;
  } else {
    windEnabled = false;
    armsUp = false;
  }
}

// ==== TREE CLASS ====
class Tree {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.state = "growing";
    this.age = 0;
    this.maxAge = int(random(200, 400));
    this.level = 0;
    this.maxLevel = floor(random(5, 8));
    this.deathProgress = 0;
    this.baseLen = random(100, 210);
    this.currentLen = this.baseLen;
    this.healthyColor = color(...random(healthyPalette));
    this.sickColor = color(...random(sickPalette));
    this.leafColor = color(...random(healthyPalette));
    this.flowerColor = color(...random(flowerPalette));
    this.root = null;
    this.flowerProbability = 0.2;
    this.leafProbability = 0.5;
  }

  update(wind, speed, windActive, armsRaised) {
    if (speed > 30 && windActive) {
      this.currentLen *= 0.96;
      this.deathProgress += 0.03;
    } else {
      if (this.currentLen < this.baseLen) this.currentLen += 0.3;
      this.deathProgress -= 0.005;
    }
    this.deathProgress = constrain(this.deathProgress, 0, 1);

    if (this.state === "growing") {
      if (this.level < this.maxLevel && frameCount % 30 === 0) {
        this.level++;
        this.root = new Node(0, 0, this.currentLen, this.level, this);
      }
      if (this.level >= this.maxLevel) this.state = "living";
    } else if (this.state === "living") {
      this.age++;
      if (this.age > this.maxAge) this.state = "dying";
    } else if (this.state === "dying") {
      if (frameCount % 30 === 0) {
        if (this.level > 0) {
          this.level--;
          this.root = new Node(0, 0, this.currentLen, this.level, this);
        } else {
          this.state = "dead";
        }
      }
    }

    if (!armsRaised && this.root) {
      this.root.regrow();
    }
  }

  draw(wind, armsRaised) {
    if (!this.root) return;
    push();
    translate(this.x, this.y);
    let trunkColor = lerpColor(this.healthyColor, this.sickColor, this.deathProgress);
    stroke(trunkColor);
    strokeWeight(2);
    this.root.draw(this.currentLen, wind, armsRaised);
    pop();
  }

  isDead() {
    return this.state === "dead";
  }
}

// ==== NODE CLASS ====
class Node {
  constructor(x, y, len, depth, tree) {
    this.x = x;
    this.y = y;
    this.len = len;
    this.depth = depth;
    this.tree = tree;
    this.baseAngle = random(-PI / 6, PI / 6);
    this.hasFlower = this.depth <= 2 && random() < this.tree.flowerProbability;
    this.hasLeaf = random() < 0.5;
    if (depth > 0) {
      this.child1 = new Node(0, -len, len * 0.7, depth - 1, tree);
      this.child2 = new Node(0, -len, len * 0.7, depth - 1, tree);
    }
  }

  draw(lenOverride, wind, armsRaised) {
    push();
    let sway = noise(this.tree.x * 0.005 + frameCount * 0.01 + this.depth) - 0.5;
    rotate(this.baseAngle + sway * wind * PI);
    line(0, 0, 0, -lenOverride);
    translate(0, -lenOverride);

        // Fleurs
    if (this.hasFlower) {
      let dropChance = armsRaised ? 0.1 : 0.0; // ← 10 % chance de tomber si bras levés
      if (random() < dropChance) {
        fallingParticles.push(new Particle(this.tree.x, this.tree.y, this.tree.flowerColor, "flower"));
        this.hasFlower = false;
      } else {
        drawFlower(this.tree.flowerColor);
      }
    }

        // Feuilles
    if (this.hasLeaf) {
      let dropChance = armsRaised ? 0.01 : 0.0; // ← idem pour les feuilles
      if (random() < dropChance) {
        fallingParticles.push(new Particle(this.tree.x, this.tree.y, this.tree.leafColor, "leaf"));
        this.hasLeaf = false;
      } else {
        drawLeaf(this.tree.leafColor);
      }
    }

    if (this.child1) this.child1.draw(lenOverride * 0.7, wind, armsRaised);
    if (this.child2) this.child2.draw(lenOverride * 0.7, wind, armsRaised);
    pop();
  }

  regrow() {
    if (!this.hasLeaf && random() < 0.005) this.hasLeaf = true;
    if (!this.hasFlower && random() < 0.003) this.hasFlower = true;
    if (this.child1) this.child1.regrow();
    if (this.child2) this.child2.regrow();
  }
}

// ==== PARTICLES ====
class Particle {
  constructor(x, y, col, type) {
    this.x = x + random(-10, 10);
    this.y = y + random(-10, 10);
    this.vx = random(-0.5, 0.5);
    this.vy = random(1, 2);
    this.col = col;
    this.type = type;
    this.lifespan = 255;
  }

  update(wind) {
    this.x += this.vx + wind * 2;
    this.y += this.vy;
    this.lifespan -= 2;
  }

  draw() {
    push();
    translate(this.x, this.y);
    noStroke();
    fill(red(this.col), green(this.col), blue(this.col), this.lifespan);
    if (this.type === "flower") {
      for (let i = 0; i < 6; i++) {
        ellipse(5, 0, 8, 4);
        rotate(PI / 3);
      }
      fill(255, 255, 200, this.lifespan);
      ellipse(0, 0, 5, 5);
    } else {
      ellipse(0, 0, 8, 4);
    }
    pop();
  }

  isDead() {
    return this.lifespan <= 0;
  }
}

// ==== DRAW FLOWER ====
function drawFlower(col) {
  push();
  noStroke();
  fill(col);
  for (let i = 0; i < 6; i++) {
    ellipse(5, 0, 8, 4);
    rotate(PI / 3);
  }
  fill(255, 255, 200);
  ellipse(0, 0, 5, 5);
  pop();
}

// ==== DRAW LEAF ====
function drawLeaf(col) {
  push();
  noStroke();
  fill(col);
  rotate(random(-PI / 6, PI / 6));
  ellipse(0, 0, 8, 4);
  pop();
}
