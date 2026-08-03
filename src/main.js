import * as THREE from "three";
import { io } from "socket.io-client";
import "./style.css";

const API_URL = (
  import.meta.env.VITE_API_URL || "https://selectstart-back.onrender.com"
).replace(/\/$/, "");
const LOGO_URL =
  import.meta.env.VITE_GATEGUARD_LOGO ||
  "https://evoprocess.github.io/Logins_Front/imagens_pub/gateguard_logo.png";
const SESSION_KEY = "selectstart_session";
const app = document.querySelector("#app");
let token = sessionStorage.getItem(SESSION_KEY) || "";
let player = null;
let socket = null;
const esc = (value) => {
  const node = document.createElement("span");
  node.textContent = String(value ?? "");
  return node.innerHTML;
};
async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}

function landing() {
  app.innerHTML = `<main class="landing screen"><section class="hero"><div><span class="eyebrow">SELECTSTART · SOBREVIVÊNCIA ONLINE</span><h1>Sua cidade.<br>Sua casa.<br>Sua história.</h1><p>Entre em uma cidade viva, encontre outros jogadores e participe de desafios de sobrevivência. Cada conta recebe uma casa numerada e persistente.</p><button class="primary" id="enter">Entrar para jogar</button></div><div class="city-card"><div><strong>1.000</strong><span>casas preparadas para jogadores reais</span></div></div></section></main>
    <dialog id="login" class="modal"><form class="login-card"><button type="button" class="close" aria-label="Fechar">×</button><img src="${LOGO_URL}" alt="GateGuard"><h2>Entrar</h2><label>Login<input name="login" autocomplete="username" required minlength="2" maxlength="80"></label><label>Senha<input name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="64"></label><label><span><input type="checkbox" data-show-password> Exibir senha</span></label><button class="primary">Entrar</button><button type="button" class="auth-link" data-open-register>Criar conta</button><p class="feedback"></p></form></dialog>
    <dialog id="register" class="modal"><form class="login-card"><button type="button" class="close" aria-label="Fechar">×</button><img src="${LOGO_URL}" alt="GateGuard"><h2>Criar conta</h2><label>Nome do jogador<input name="name" autocomplete="name" required minlength="2" maxlength="120"></label><label>Login<input name="login" autocomplete="username" required minlength="2" maxlength="80"></label><label>Senha<input name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="64"></label><label>Confirmar senha<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="8" maxlength="64"></label><label><span><input type="checkbox" data-show-password> Exibir senhas</span></label><button class="primary">Criar minha conta</button><button type="button" class="auth-link" data-open-login>Já tenho uma conta</button><p class="feedback"></p></form></dialog>`;
  const loginModal = app.querySelector("#login");
  const registerModal = app.querySelector("#register");
  const loginForm = loginModal.querySelector("form");
  const registerForm = registerModal.querySelector("form");
  const switchModal = (current, next) => {
    current.close();
    current.querySelector(".feedback").textContent = "";
    next.showModal();
  };

  app.querySelector("#enter").onclick = () => loginModal.showModal();
  loginModal.querySelector(".close").onclick = () => loginModal.close();
  registerModal.querySelector(".close").onclick = () => registerModal.close();
  app.querySelector("[data-open-register]").onclick = () => switchModal(loginModal, registerModal);
  app.querySelector("[data-open-login]").onclick = () => switchModal(registerModal, loginModal);
  app.querySelectorAll("[data-show-password]").forEach((checkbox) => {
    checkbox.onchange = (event) => {
      event.currentTarget.form.querySelectorAll('input[type="password"], input[data-password-visible]').forEach((input) => {
        input.type = event.currentTarget.checked ? "text" : "password";
        input.toggleAttribute("data-password-visible", event.currentTarget.checked);
      });
    };
  });

  loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const button = e.submitter;
    button.disabled = true;
    const feedback = loginForm.querySelector(".feedback");
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      feedback.textContent = "Validando acesso e pagamento...";
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(values),
      });
      token = data.token;
      player = data.player;
      sessionStorage.setItem(SESSION_KEY, token);
      loginModal.close();
      lobby();
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };

  registerForm.onsubmit = async (e) => {
    e.preventDefault();
    const button = e.submitter;
    const feedback = registerForm.querySelector(".feedback");
    const values = Object.fromEntries(new FormData(e.currentTarget));
    button.disabled = true;
    try {
      if (values.password !== values.confirmPassword) throw new Error("As senhas não coincidem.");
      feedback.textContent = "Criando sua conta segura...";
      await api("/api/auth/register", { method: "POST", body: JSON.stringify(values) });
      registerForm.reset();
      switchModal(registerModal, loginModal);
      loginForm.querySelector("[name=login]").value = values.login;
      loginForm.querySelector(".feedback").textContent = "Conta criada. Agora entre para jogar.";
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
}

function connect() {
  if (socket) return;
  socket = io(API_URL, {
    auth: { token },
    transports: ["websocket", "polling"],
  });
  socket.on("connect_error", (error) => notice(error.message));
  socket.on("challenge:list", renderChallenges);
  socket.on("challenge:update", (challenge) => {
    if (challenge.players.some((item) => item.id === player.id)) {
      if (challenge.state === "playing") startGame(challenge);
      else if (challenge.state === "finished") finishGame(challenge);
      else waiting(challenge);
    }
  });
}
function lobby() {
  if (waitingTimer) {
    clearInterval(waitingTimer);
    waitingTimer = null;
  }
  app.innerHTML = `<main class="lobby screen"><header class="topbar"><div><strong>SelectStart Online</strong><small>${esc(player.displayName)}</small></div><button id="logout">Sair</button></header><div class="lobby-grid"><section class="profile"><span>SUA CASA</span><div class="house-number">#${player.houseNumber}</div><p>Esta residência está reservada para sua conta na cidade.</p><button class="primary" id="create">Criar desafio</button></section><section class="challenges"><h2>Desafios abertos</h2><p>A partida começa assim que o segundo jogador entrar.</p><div id="challenge-list">Conectando...</div></section></div><p id="notice" class="waiting"></p></main>`;
  app.querySelector("#logout").onclick = () => {
    sessionStorage.removeItem(SESSION_KEY);
    token = "";
    player = null;
    socket?.disconnect();
    socket = null;
    landing();
  };
  app.querySelector("#create").onclick = () =>
    socket.emit("challenge:create", {}, (response) => {
      if (!response.ok) notice(response.error);
    });
  connect();
}
function renderChallenges(challenges) {
  const box = app.querySelector("#challenge-list");
  if (!box) return;
  box.innerHTML =
    challenges
      .map(
        (item) =>
          `<div class="challenge"><div><strong>Desafio ${esc(item.id.slice(0, 8))}</strong><br><span>${item.players.length}/${item.targetPlayers} jogadores</span></div><button data-join="${esc(item.id)}">Participar</button></div>`,
      )
      .join("") || "<p>Nenhum desafio aberto. Crie o primeiro.</p>";
  box.querySelectorAll("[data-join]").forEach(
    (button) =>
      (button.onclick = () =>
        socket.emit(
          "challenge:join",
          { id: button.dataset.join },
          (response) => {
            if (!response.ok) notice(response.error);
          },
        )),
  );
}
function waiting(challenge) {
  app.innerHTML = `<main class="waiting screen"><h1>Aguardando outro jogador</h1><p>${challenge.players.length}/${challenge.targetPlayers} confirmados</p><div class="countdown" id="countdown"></div><p>A partida começa imediatamente quando o segundo jogador entrar.</p></main>`;
  const update = () => {
    const el = app.querySelector("#countdown");
    if (el)
      el.textContent = `${Math.max(0, Math.ceil((challenge.startsAt - Date.now()) / 1000))}s`;
  };
  update();
  if (waitingTimer) clearInterval(waitingTimer);
  waitingTimer = setInterval(update, 1000);
}
function notice(message) {
  const node = app.querySelector("#notice");
  if (node) node.textContent = message;
}

let gameCleanup = null;
let waitingTimer = null;
function startGame(initial) {
  if (app.querySelector(".game")) return;
  if (waitingTimer) {
    clearInterval(waitingTimer);
    waitingTimer = null;
  }
  gameCleanup?.();
  app.innerHTML =
    '<main class="game"><div class="hud"><div id="health">Vida 100</div><div id="players"></div></div><aside class="minimap"><strong>MAPA</strong><canvas id="minimap" width="180" height="180"></canvas><small><i class="you"></i> Você <i class="enemy"></i> Adversário</small></aside><div class="crosshair"></div><div class="game-message">Clique para controlar · WASD para andar · Espaço para pular · clique para atacar</div></main>';
  const container = app.querySelector(".game");
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b9df);
  scene.fog = new THREE.Fog(0x87b9df, 70, 210);
  const camera = new THREE.PerspectiveCamera(
    70,
    innerWidth / innerHeight,
    0.1,
    400,
  );
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  container.append(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x355132, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(40, 70, 25);
  scene.add(sun);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(260, 260),
    new THREE.MeshStandardMaterial({ color: 0x4b7848 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const houseGeo = new THREE.BoxGeometry(4, 3, 4),
    houseMat = new THREE.MeshStandardMaterial({ color: 0xc9a77d });
  const houses = new THREE.InstancedMesh(houseGeo, houseMat, 180);
  const matrix = new THREE.Matrix4();
  const houseColliders = [];
  let houseIndex = 0;
  for (let i = 0; i < 180; i++) {
    const col = i % 18,
      row = Math.floor(i / 18);
    const x = (col - 9) * 13, z = (row - 5) * 15;
    if (Math.hypot(x, z) < 32) continue;
    matrix.setPosition(x, 1.5, z);
    houses.setMatrixAt(houseIndex++, matrix);
    houseColliders.push({ x, z, halfX: 2, halfZ: 2 });
  }
  houses.count = houseIndex;
  houses.castShadow = true;
  houses.receiveShadow = true;
  scene.add(houses);
  const trunkGeo = new THREE.BoxGeometry(.7, 3, .7);
  const crownGeo = new THREE.BoxGeometry(2.8, 2.8, 2.8);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6f4728 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x2f6f3a });
  const treeColliders = [];
  for (let i = 0; i < 45; i++) {
    const x = ((i * 37) % 210) - 105, z = ((i * 61) % 210) - 105;
    if (Math.hypot(x, z) < 28) continue;
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    const crown = new THREE.Mesh(crownGeo, crownMat);
    trunk.position.set(x, 1.5, z); crown.position.set(x, 4.2, z);
    trunk.castShadow = crown.castShadow = true; scene.add(trunk, crown);
    treeColliders.push({ x, z, radius: .7 });
  }
  const isBlocked = (x, z) =>
    houseColliders.some((box) => Math.abs(x - box.x) < box.halfX + .48 && Math.abs(z - box.z) < box.halfZ + .48) ||
    treeColliders.some((tree) => Math.hypot(x - tree.x, z - tree.z) < tree.radius + .48);
  const meshes = new Map(),
    keys = {};
  let state = initial;
  const own = () => state.players.find((p) => p.id === player.id);
  function sync(next) {
    state = next;
    for (const item of next.players) {
      let mesh = meshes.get(item.id);
      if (!mesh) {
        mesh = createCharacter(item.id === player.id ? 0x1684ff : 0xff5533);
        scene.add(mesh);
        meshes.set(item.id, mesh);
      }
      if (item.id === player.id) mesh.position.set(item.x, item.y - 1, item.z);
      else mesh.userData.target.set(item.x, item.y - 1, item.z);
      // O eixo frontal do modelo é -Z; o sinal invertido mantém rosto,
      // câmera e direção enviada pelo servidor apontando para o mesmo lado.
      mesh.rotation.y = -item.rotation;
      mesh.visible = item.alive;
    }
    for (const [id, mesh] of meshes)
      if (!next.players.some((p) => p.id === id)) {
        scene.remove(mesh);
        meshes.delete(id);
      }
    const me = own();
    if (me) {
      app.querySelector("#health").textContent = `Vida ${me.health}`;
      app.querySelector("#health").classList.toggle("danger", !me.alive);
    }
    app.querySelector("#players").textContent =
      `Vivos ${next.players.filter((p) => p.alive).length}`;
  }
  function createCharacter(color) {
    const group = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xe6ad7c });
    const clothes = new THREE.MeshStandardMaterial({ color });
    const dark = new THREE.MeshStandardMaterial({ color: 0x243047 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x3a2417 });
    const shoes = new THREE.MeshStandardMaterial({ color: 0x181b22 });
    const part = (geometry, material, x, y, z) => {
      const object = new THREE.Mesh(geometry, material);
      object.position.set(x, y, z); object.castShadow = true; group.add(object);
      return object;
    };
    const head = part(new THREE.BoxGeometry(.72, .72, .72), skin, 0, 2.65, 0);
    part(new THREE.BoxGeometry(.82, 1.05, .48), clothes, 0, 1.72, 0);
    const leftArm = part(new THREE.BoxGeometry(.28, 1, .28), skin, -.58, 1.72, 0);
    const rightArm = part(new THREE.BoxGeometry(.28, 1, .28), skin, .58, 1.72, 0);
    const leftLeg = part(new THREE.BoxGeometry(.34, 1, .38), dark, -.24, .7, 0);
    const rightLeg = part(new THREE.BoxGeometry(.34, 1, .38), dark, .24, .7, 0);
    const leftFoot = part(new THREE.BoxGeometry(.36, .24, .55), shoes, -.24, .14, -.08);
    const rightFoot = part(new THREE.BoxGeometry(.36, .24, .55), shoes, .24, .14, -.08);
    part(new THREE.BoxGeometry(.76, .18, .76), hair, 0, 3.04, 0);
    part(new THREE.BoxGeometry(.76, .42, .12), hair, 0, 2.82, .35);
    const faceMat = new THREE.MeshBasicMaterial({ color: 0x23180f });
    const eyeGeo = new THREE.BoxGeometry(.11, .11, .025);
    const mouthGeo = new THREE.BoxGeometry(.22, .055, .025);
    const leftEye = part(eyeGeo, faceMat, -.17, 2.72, -.371);
    const rightEye = part(eyeGeo, faceMat, .17, 2.72, -.371);
    const mouth = part(mouthGeo, faceMat, 0, 2.49, -.371);
    head.add(leftEye, rightEye, mouth);
    leftEye.position.set(-.17, .07, -.371); rightEye.position.set(.17, .07, -.371); mouth.position.set(0, -.16, -.371);
    leftLeg.add(leftFoot); rightLeg.add(rightFoot);
    leftFoot.position.set(0, -.56, -.08); rightFoot.position.set(0, -.56, -.08);
    group.userData.limbs = { leftArm, rightArm, leftLeg, rightLeg };
    group.userData.target = new THREE.Vector3();
    return group;
  }
  function animateCharacter(character, time, moving) {
    const limbs = character.userData.limbs;
    if (!limbs) return;
    const swing = moving ? Math.sin(time * .012) * .65 : 0;
    limbs.leftArm.rotation.x = THREE.MathUtils.lerp(limbs.leftArm.rotation.x, swing, .22);
    limbs.rightArm.rotation.x = THREE.MathUtils.lerp(limbs.rightArm.rotation.x, -swing, .22);
    limbs.leftLeg.rotation.x = THREE.MathUtils.lerp(limbs.leftLeg.rotation.x, -swing, .22);
    limbs.rightLeg.rotation.x = THREE.MathUtils.lerp(limbs.rightLeg.rotation.x, swing, .22);
  }
  sync(initial);
  const onUpdate = (next) => {
    if (next.state === "finished") {
      finishGame(next);
      return;
    }
    sync(next);
  };
  socket.on("challenge:update", onUpdate);
  renderer.domElement.onclick = () => {
    if (document.pointerLockElement !== renderer.domElement) {
      renderer.domElement.requestPointerLock();
      return;
    }
    const me = own();
    if (!me?.alive) return;
    const origin = new THREE.Vector2(0, 0),
      ray = new THREE.Raycaster();
    ray.setFromCamera(origin, camera);
    const targets = [...meshes.entries()]
      .filter(([id]) => id !== player.id)
      .map(([, mesh]) => mesh);
    const hit = ray.intersectObjects(targets, true)[0];
    if (hit) {
      const target = [...meshes.entries()].find(
        ([, mesh]) => {
          let object = hit.object;
          while (object) {
            if (object === mesh) return true;
            object = object.parent;
          }
          return false;
        },
      )?.[0];
      if (target) socket.emit("player:shoot", { targetId: target });
    }
  };
  const keydown = (e) => (keys[e.key.toLowerCase()] = true);
  const keyup = (e) => (keys[e.key.toLowerCase()] = false);
  addEventListener("keydown", keydown);
  addEventListener("keyup", keyup);
  let yaw = 0, verticalSpeed = 0, grounded = true, lastMoveSent = 0;
  const mouse = (e) => {
    if (document.pointerLockElement === renderer.domElement)
      yaw -= e.movementX * 0.002;
  };
  addEventListener("mousemove", mouse);
  const resize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  };
  addEventListener("resize", resize);
  const minimap = app.querySelector("#minimap");
  const mapContext = minimap.getContext("2d");
  function drawMinimap() {
    const size = minimap.width, scale = size / 260;
    mapContext.clearRect(0, 0, size, size);
    mapContext.fillStyle = "#173c2c"; mapContext.fillRect(0, 0, size, size);
    mapContext.strokeStyle = "#ffffff22"; mapContext.lineWidth = 1;
    for (let line = 20; line < size; line += 20) {
      mapContext.beginPath(); mapContext.moveTo(line, 0); mapContext.lineTo(line, size); mapContext.stroke();
      mapContext.beginPath(); mapContext.moveTo(0, line); mapContext.lineTo(size, line); mapContext.stroke();
    }
    for (const item of state.players) {
      if (!item.alive) continue;
      const x = size / 2 + item.x * scale, y = size / 2 + item.z * scale;
      mapContext.save(); mapContext.translate(x, y); mapContext.rotate(-item.rotation);
      mapContext.fillStyle = item.id === player.id ? "#37a2ff" : "#ff5147";
      mapContext.beginPath(); mapContext.moveTo(0, -7); mapContext.lineTo(5, 5); mapContext.lineTo(-5, 5); mapContext.closePath(); mapContext.fill();
      mapContext.restore();
    }
    mapContext.strokeStyle = "#ffffff88"; mapContext.strokeRect(.5, .5, size - 1, size - 1);
  }
  let last = performance.now();
  let stopped = false;
  function frame(now) {
    if (stopped) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const me = own();
    if (me?.alive) {
      const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw) * -1),
        right = new THREE.Vector3(-forward.z, 0, forward.x),
        direction = new THREE.Vector3();
      if (keys.w) direction.add(forward);
      if (keys.s) direction.sub(forward);
      if (keys.d) direction.add(right);
      if (keys.a) direction.sub(right);
      if (keys[" "] && grounded) { verticalSpeed = 10.5; grounded = false; }
      verticalSpeed -= 34 * dt;
      me.y = Math.max(1, me.y + verticalSpeed * dt);
      if (me.y <= 1) { me.y = 1; verticalSpeed = 0; grounded = true; }
      if (direction.lengthSq()) {
        direction.normalize().multiplyScalar(7 * dt);
        const nextX = Math.max(-120, Math.min(120, me.x + direction.x));
        const nextZ = Math.max(-120, Math.min(120, me.z + direction.z));
        if (!isBlocked(nextX, me.z)) me.x = nextX;
        if (!isBlocked(me.x, nextZ)) me.z = nextZ;
      }
      me.rotation = yaw;
      if (direction.lengthSq() || !grounded || now - lastMoveSent > 100) {
        socket.emit("player:move", { x: me.x, y: me.y, z: me.z, rotation: yaw });
        lastMoveSent = now;
      }
      const ownMesh = meshes.get(player.id);
      if (ownMesh) {
        ownMesh.position.set(me.x, me.y - 1, me.z);
        animateCharacter(ownMesh, now, direction.lengthSq() > 0 && grounded);
      }
      camera.position.set(
        me.x - Math.sin(yaw) * 5,
        me.y + 3.2,
        me.z + Math.cos(yaw) * 5,
      );
      camera.lookAt(me.x, me.y + 1.4, me.z);
    }
    for (const [id, mesh] of meshes)
      if (id !== player.id) {
        const moving = mesh.position.distanceToSquared(mesh.userData.target) > .0004;
        mesh.position.lerp(mesh.userData.target, Math.min(1, dt * 12));
        animateCharacter(mesh, now, moving);
      }
    drawMinimap();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  gameCleanup = () => {
    stopped = true;
    socket.off("challenge:update", onUpdate);
    removeEventListener("keydown", keydown);
    removeEventListener("keyup", keyup);
    removeEventListener("mousemove", mouse);
    removeEventListener("resize", resize);
    renderer.dispose();
  };
}
function finishGame(challenge) {
  gameCleanup?.();
  gameCleanup = null;
  const won = challenge.winner === player.id;
  app.innerHTML = `<main class="waiting screen"><h1>${won ? "Você venceu!" : "Partida encerrada"}</h1><p>${won ? "Último sobrevivente. Vitória registrada." : "O último sobrevivente venceu o desafio."}</p><button class="primary" id="back">Voltar ao lobby</button></main>`;
  app.querySelector("#back").onclick = lobby;
}

async function boot() {
  if (!token) return landing();
  try {
    const data = await api("/api/auth/session");
    player = data.player;
    lobby();
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    token = "";
    landing();
  }
}
boot();
