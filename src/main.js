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
  app.innerHTML = `<main class="landing screen"><section class="hero"><div><span class="eyebrow">SELECTSTART · SOBREVIVÊNCIA ONLINE</span><h1>Sua cidade.<br>Sua casa.<br>Sua história.</h1><p>Entre em uma cidade viva, encontre outros jogadores e participe de desafios de sobrevivência. Cada conta recebe uma casa numerada e persistente.</p><button class="primary" id="enter">Entrar para jogar</button></div><div class="city-card"><div><strong>1.000</strong><span>casas preparadas para jogadores reais</span></div></div></section></main><dialog id="login" class="modal"><form class="login-card" data-mode="login"><button type="button" class="close">×</button><img src="${LOGO_URL}" alt="GateGuard"><div class="auth-tabs"><button type="button" class="is-active" data-auth-mode="login">Entrar</button><button type="button" data-auth-mode="register">Criar conta</button></div><label data-register-field hidden>Nome do jogador<input name="name" autocomplete="name" minlength="2" maxlength="120"></label><label>Login<input name="login" autocomplete="username" required minlength="2" maxlength="80"></label><label>Senha<input name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="64"></label><label data-register-field hidden>Confirmar senha<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="64"></label><label><span><input type="checkbox" id="show-password"> Exibir senha</span></label><button class="primary" id="auth-submit">Entrar</button><p class="feedback"></p></form></dialog>`;
  const modal = app.querySelector("#login");
  const form = app.querySelector("form");
  const setMode = (mode) => {
    form.dataset.mode = mode;
    form.querySelectorAll("[data-register-field]").forEach((field) => {
      field.hidden = mode !== "register";
      field.querySelector("input").required = mode === "register";
    });
    form.querySelectorAll("[data-auth-mode]").forEach((button) =>
      button.classList.toggle("is-active", button.dataset.authMode === mode),
    );
    form.querySelector("#auth-submit").textContent = mode === "register" ? "Criar minha conta" : "Entrar";
    form.querySelector("[name=password]").autocomplete = mode === "register" ? "new-password" : "current-password";
    form.querySelector(".feedback").textContent = "";
  };
  app.querySelector("#enter").onclick = () => modal.showModal();
  app.querySelector(".close").onclick = () => modal.close();
  form.querySelectorAll("[data-auth-mode]").forEach((button) => (button.onclick = () => setMode(button.dataset.authMode)));
  app.querySelector("#show-password").onchange = (e) => {
    form.querySelectorAll('[name="password"],[name="confirmPassword"]').forEach((input) => { input.type = e.target.checked ? "text" : "password"; });
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const button = e.submitter;
    button.disabled = true;
    const feedback = app.querySelector(".feedback");
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (form.dataset.mode === "register") {
        if (values.password !== values.confirmPassword) throw new Error("As senhas não coincidem.");
        feedback.textContent = "Criando sua conta segura...";
        await api("/api/auth/register", { method: "POST", body: JSON.stringify(values) });
        setMode("login");
        feedback.textContent = "Conta criada. Agora entre para jogar.";
        return;
      }
      feedback.textContent = "Validando acesso e pagamento...";
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(values),
      });
      token = data.token;
      player = data.player;
      sessionStorage.setItem(SESSION_KEY, token);
      modal.close();
      lobby();
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
  app.innerHTML = `<main class="lobby screen"><header class="topbar"><div><strong>SelectStart Online</strong><small>${esc(player.displayName)}</small></div><button id="logout">Sair</button></header><div class="lobby-grid"><section class="profile"><span>SUA CASA</span><div class="house-number">#${player.houseNumber}</div><p>Esta residência está reservada para sua conta na cidade.</p><button class="primary" id="create">Criar desafio</button></section><section class="challenges"><h2>Desafios abertos</h2><p>Começa com 3 jogadores ou, após 2 minutos, com pelo menos 2.</p><div id="challenge-list">Conectando...</div></section></div><p id="notice" class="waiting"></p></main>`;
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
  app.innerHTML = `<main class="waiting screen"><h1>Aguardando jogadores</h1><p>${challenge.players.length}/${challenge.targetPlayers} confirmados</p><div class="countdown" id="countdown"></div><p>Com 3 participantes começa imediatamente. Com 2, começa ao final da espera.</p></main>`;
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
    '<main class="game"><div class="hud"><div id="health">Vida 100</div><div id="players"></div></div><div class="crosshair"></div><div class="game-message">Clique para controlar · WASD para mover · clique para atirar</div></main>';
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
  scene.add(ground);
  const houseGeo = new THREE.BoxGeometry(4, 3, 4),
    houseMat = new THREE.MeshStandardMaterial({ color: 0xc9a77d });
  const houses = new THREE.InstancedMesh(houseGeo, houseMat, 1000);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 1000; i++) {
    const col = i % 40,
      row = Math.floor(i / 40);
    matrix.setPosition((col - 20) * 6, 1.5, (row - 12) * 7);
    houses.setMatrixAt(i, matrix);
  }
  scene.add(houses);
  const meshes = new Map(),
    keys = {};
  let state = initial;
  const own = () => state.players.find((p) => p.id === player.id);
  function sync(next) {
    state = next;
    for (const item of next.players) {
      let mesh = meshes.get(item.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(1, 2, 1),
          new THREE.MeshStandardMaterial({
            color: item.id === player.id ? 0x1684ff : 0xff5533,
          }),
        );
        scene.add(mesh);
        meshes.set(item.id, mesh);
      }
      mesh.position.set(item.x, 1, item.z);
      mesh.rotation.y = item.rotation;
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
    const hit = ray.intersectObjects(targets, false)[0];
    if (hit) {
      const target = [...meshes.entries()].find(
        ([, mesh]) => mesh === hit.object,
      )?.[0];
      if (target) socket.emit("player:shoot", { targetId: target });
    }
  };
  const keydown = (e) => (keys[e.key.toLowerCase()] = true);
  const keyup = (e) => (keys[e.key.toLowerCase()] = false);
  addEventListener("keydown", keydown);
  addEventListener("keyup", keyup);
  let yaw = 0;
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
  let last = performance.now();
  let stopped = false;
  function frame(now) {
    if (stopped) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const me = own();
    if (me?.alive) {
      const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw) * -1),
        right = new THREE.Vector3(forward.z, 0, -forward.x),
        direction = new THREE.Vector3();
      if (keys.w) direction.add(forward);
      if (keys.s) direction.sub(forward);
      if (keys.d) direction.add(right);
      if (keys.a) direction.sub(right);
      if (direction.lengthSq()) {
        direction.normalize().multiplyScalar(7 * dt);
        me.x = Math.max(-120, Math.min(120, me.x + direction.x));
        me.z = Math.max(-120, Math.min(120, me.z + direction.z));
        me.rotation = yaw;
        socket.emit("player:move", { x: me.x, z: me.z, rotation: yaw });
      }
      camera.position.set(
        me.x - Math.sin(yaw) * 5,
        4,
        me.z + Math.cos(yaw) * 5,
      );
      camera.lookAt(me.x, 1.5, me.z);
    }
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
