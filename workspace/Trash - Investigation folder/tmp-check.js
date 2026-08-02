
    const cfg = {
      moveSpeed: 6.4,
      jumpSpeed: 8.6,
      gravity: -32,
      lookSpeed: 0.0025,
      touchLookSpeed: 0.0048,
      interactDistance: 6,
      eyeHeight: 1.6,
      worldSize: 24,
    };

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8fd4ff);
    scene.fog = new THREE.Fog(0x8fd4ff, 14, 150);

    const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 500);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    document.body.appendChild(renderer.domElement);

    // Player rig
    const player = new THREE.Object3D();
    const pitch = new THREE.Object3D();
    player.add(pitch);
    pitch.position.y = cfg.eyeHeight;
    pitch.add(camera);
    player.position.set(0, 0, 10);
    scene.add(player);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(10, 16, 8);
    scene.add(sun);

    // Voxel map
    const blocks = new Map();
    const meshes = [];
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mats = {
      grass: new THREE.MeshStandardMaterial({ color: 0x57a957 }),
      dirt: new THREE.MeshStandardMaterial({ color: 0x9a6433 }),
      stone: new THREE.MeshStandardMaterial({ color: 0x7a7a7a }),
    };

    const keyAt = (x, y, z) => `${x},${y},${z}`;

    function addBlock(x, y, z, type = 'stone') {
      const key = keyAt(x, y, z);
      if (blocks.has(key)) return false;
      const m = new THREE.Mesh(geo, mats[type]);
      m.position.set(x, y, z);
      m.userData = { x, y, z, type };
      scene.add(m);
      blocks.set(key, m);
      meshes.push(m);
      return true;
    }

    function removeBlock(m) {
      if (!m || !m.userData) return;
      const { x, y, z } = m.userData;
      const key = keyAt(x, y, z);
      blocks.delete(key);
      const idx = meshes.indexOf(m);
      if (idx >= 0) meshes.splice(idx, 1);
      scene.remove(m);
    }

    for (let x = -cfg.worldSize; x <= cfg.worldSize; x++) {
      for (let z = -cfg.worldSize; z <= cfg.worldSize; z++) {
        addBlock(x, -1, z, 'stone');
        addBlock(x, 0, z, 'grass');
      }
    }
    for (let i = 0; i < 130; i++) {
      const x = Math.floor(Math.random() * (cfg.worldSize * 2 + 1)) - cfg.worldSize;
      const z = Math.floor(Math.random() * (cfg.worldSize * 2 + 1)) - cfg.worldSize;
      const h = 1 + Math.floor(Math.random() * 3);
      for (let y = 1; y <= h; y++) {
        addBlock(x, y, z, y === 1 ? 'dirt' : 'stone');
      }
    }

    // UI refs
    const hud = document.getElementById('hud');
    const overlay = document.getElementById('startOverlay');
    const startBtn = document.getElementById('startBtn');
    const mobileControls = document.getElementById('mobileControls');
    const joystick = document.getElementById('joystick');
    const knob = document.getElementById('knob');
    const lookPad = document.getElementById('lookPad');
    const jumpBtn = document.getElementById('jumpBtn');
    const mineBtn = document.getElementById('mineBtn');
    const placeBtn = document.getElementById('placeBtn');

    const isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

    if (isMobile) {
      mobileControls.style.display = 'block';
      hud.textContent = 'Mobile: left joystick to move, right-side drag to look, JUMP/MINE/PLACE buttons.';
    } else {
      hud.textContent = 'Desktop: click Start, then WASD move, mouse look, LMB mine, RMB place, Space jump.';
    }

    const input = {
      forward: 0,
      strafe: 0,
      jump: false,
      mine: false,
      place: false,
    };

    let running = false;
    let pointerLocked = false;
    let onGround = true;
    let vy = 0;

    const raycaster = new THREE.Raycaster();
    const downRay = new THREE.Raycaster();
    const downDir = new THREE.Vector3(0, -1, 0);
    const rightDrag = { active: false, x: 0, y: 0 };

    function setHud(text) {
      hud.textContent = text;
    }

    function startGame() {
      running = true;
      overlay.style.display = 'none';
      if (!isMobile) {
        try {
          if (document.pointerLockElement !== renderer.domElement) {
            renderer.domElement.requestPointerLock();
          }
        } catch {}
      } else {
        setHud('Mobile controls active. Move, look, mine/place now.');
      }
    }

    function applyLook(dx, dy, touch = false) {
      const sx = dx * (touch ? cfg.touchLookSpeed : cfg.lookSpeed);
      const sy = dy * (touch ? cfg.touchLookSpeed : cfg.lookSpeed);

      player.rotation.y -= sx;
      pitch.rotation.x -= sy;
      const limit = Math.PI / 2 - 0.12;
      if (pitch.rotation.x > limit) pitch.rotation.x = limit;
      if (pitch.rotation.x < -limit) pitch.rotation.x = -limit;
    }

    function getCrosshairHit() {
      const origin = new THREE.Vector3();
      const dir = new THREE.Vector3();
      camera.getWorldPosition(origin);
      camera.getWorldDirection(dir);
      raycaster.set(origin, dir, 0, cfg.interactDistance);
      const hits = raycaster.intersectObjects(meshes, false);
      return hits[0] || null;
    }

    function mineNow() {
      const hit = getCrosshairHit();
      if (hit) removeBlock(hit.object);
    }

    function placeNow() {
      const hit = getCrosshairHit();
      if (!hit || !hit.face) return;
      const n = hit.face.normal;
      const b = hit.object.userData;
      const x = Math.round(b.x + n.x);
      const y = Math.round(b.y + n.y);
      const z = Math.round(b.z + n.z);

      const eye = new THREE.Vector3();
      camera.getWorldPosition(eye);
      const d2 = (x - eye.x) ** 2 + (y - eye.y) ** 2 + (z - eye.z) ** 2;
      if (d2 < 1.7 * 1.7) return;
      addBlock(x, y, z, 'stone');
    }

    function groundHeightAt(x, z) {
      const from = new THREE.Vector3(x, 40, z);
      downRay.set(from, downDir, 0, 100);
      const hits = downRay.intersectObjects(meshes, false);
      if (!hits.length) return null;
      return hits[0].point.y;
    }

    function bindStart() {
      overlay.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        startGame();
      }, { passive: false });
      startBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        startGame();
      }, { passive: false });
    }

    // Desktop controls
    function bindDesktop() {
      addEventListener('pointerlockchange', () => {
        pointerLocked = document.pointerLockElement === renderer.domElement;
        if (pointerLocked) setHud('Pointer locked. WASD move, mouse look, LMB mine, RMB place, Space jump.');
        else if (!isMobile) setHud('Pointer unlocked. Click Start to re-lock.');
      });

      renderer.domElement.addEventListener('pointerdown', (e) => {
        if (isMobile) return;

        if (!running) {
          startGame();
          return;
        }

        if (e.button === 0) mineNow();
        else if (e.button === 2) placeNow();

        if (e.button === 2 && !pointerLocked) {
          rightDrag.active = true;
          rightDrag.x = e.clientX;
          rightDrag.y = e.clientY;
        }
      }, { passive: true });

      renderer.domElement.addEventListener('pointerup', (e) => {
        if (e.button === 2) rightDrag.active = false;
      }, { passive: true });

      renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault(), { passive: true });

      renderer.domElement.addEventListener('pointermove', (e) => {
        if (isMobile || !running) return;
        if (!pointerLocked) return;
        applyLook(e.movementX || 0, e.movementY || 0);
      }, { passive: true });

      addEventListener('pointermove', (e) => {
        if (isMobile || !running || pointerLocked) return;
        if (!rightDrag.active || !(e.buttons & 2)) return;
        const dx = e.clientX - rightDrag.x;
        const dy = e.clientY - rightDrag.y;
        rightDrag.x = e.clientX;
        rightDrag.y = e.clientY;
        applyLook(dx, dy);
      }, { passive: true });

      const keyMap = {
        KeyW: ['forward', 1],
        KeyS: ['forward', -1],
        KeyA: ['strafe', -1],
        KeyD: ['strafe', 1],
      };

      addEventListener('keydown', (e) => {
        const m = keyMap[e.code];
        if (m) input[m[0]] = m[1];
        if (e.code === 'Space') {
          input.jump = true;
          if (!running) startGame();
        }
      });

      addEventListener('keyup', (e) => {
        const m = keyMap[e.code];
        if (!m) return;
        if (input[m[0]] === m[1]) input[m[0]] = 0;
      });
    }

    // Mobile controls
    function bindMobile() {
      let movePointerId = null;
      let lookPointerId = null;
      let moveCenter = { x: 0, y: 0, r: 1 };
      let lookPrev = { x: 0, y: 0 };

      function setKnob(nx, ny) {
        const rad = joystick.clientWidth * 0.5;
        const limit = rad - 26;
        knob.style.transform = `translate(${nx * limit}px, ${ny * limit}px)`;
      }

      function updateMove(x, y) {
        const dx = x - moveCenter.x;
        const dy = y - moveCenter.y;
        const dist = Math.hypot(dx, dy);
        const clamped = Math.min(moveCenter.r, dist);
        const sx = dist === 0 ? 0 : (dx / moveCenter.r) * (clamped / moveCenter.r);
        const sy = dist === 0 ? 0 : (dy / moveCenter.r) * (clamped / moveCenter.r);
        input.strafe = Math.max(-1, Math.min(1, sx));
        input.forward = Math.max(-1, Math.min(1, -sy));
        setKnob(input.strafe, input.forward);
      }

      function stopMove() {
        movePointerId = null;
        input.strafe = 0;
        input.forward = 0;
        setKnob(0, 0);
      }

      function stopLook() {
        lookPointerId = null;
      }

      function beginMove(id, x, y) {
        movePointerId = id;
        const rect = joystick.getBoundingClientRect();
        moveCenter = {
          x: rect.left + rect.width * 0.5,
          y: rect.top + rect.height * 0.5,
          r: rect.width * 0.5,
        };
        updateMove(x, y);
      }

      function beginLook(id, x, y) {
        lookPointerId = id;
        lookPrev.x = x;
        lookPrev.y = y;
      }

      function applyLookMove(x, y) {
        const dx = x - lookPrev.x;
        const dy = y - lookPrev.y;
        lookPrev.x = x;
        lookPrev.y = y;
        applyLook(dx, dy, true);
      }

      joystick.addEventListener('pointerdown', (e) => {
        if (movePointerId !== null) return;
        beginMove(e.pointerId, e.clientX, e.clientY);
      }, { passive: false });

      joystick.addEventListener('pointermove', (e) => {
        if (e.pointerId !== movePointerId) return;
        updateMove(e.clientX, e.clientY);
      }, { passive: false });

      joystick.addEventListener('pointerup', (e) => {
        if (e.pointerId === movePointerId) stopMove();
      }, { passive: true });

      joystick.addEventListener('pointercancel', stopMove, { passive: true });

      lookPad.addEventListener('pointerdown', (e) => {
        if (lookPointerId !== null) return;
        beginLook(e.pointerId, e.clientX, e.clientY);
      }, { passive: false });

      lookPad.addEventListener('pointermove', (e) => {
        if (e.pointerId !== lookPointerId) return;
        applyLookMove(e.clientX, e.clientY);
      }, { passive: false });

      lookPad.addEventListener('pointerup', (e) => {
        if (e.pointerId === lookPointerId) stopLook();
      }, { passive: true });

      lookPad.addEventListener('pointercancel', stopLook, { passive: true });

      const bindAction = (btn, setter) => {
        btn.addEventListener('pointerdown', (e) => {
          setter();
          e.preventDefault();
        }, { passive: false });
      };

      bindAction(jumpBtn, () => { input.jump = true; });
      bindAction(mineBtn, () => { input.mine = true; });
      bindAction(placeBtn, () => { input.place = true; });

      // touch fallback for older mobile browsers that miss pointer events
      // keep them as touchstart so they still work if pointer events are flaky
      function bindTouchFallback(el, startFn, moveFn, endFn) {
        const active = { id: null };
        el.addEventListener('touchstart', (e) => {
          const t = e.changedTouches[0];
          if (!t) return;
          active.id = t.identifier;
          if (startFn) startFn(t.identifier, t.clientX, t.clientY);
          e.preventDefault();
        }, { passive: false });
        el.addEventListener('touchmove', (e) => {
          for (const t of e.changedTouches) {
            if (t.identifier !== active.id) continue;
            if (moveFn) moveFn(t.identifier, t.clientX, t.clientY);
            e.preventDefault();
            break;
          }
        }, { passive: false });
        el.addEventListener('touchend', (e) => {
          for (const t of e.changedTouches) {
            if (t.identifier !== active.id) continue;
            if (endFn) endFn(t.identifier);
            active.id = null;
            break;
          }
        }, { passive: false });
        el.addEventListener('touchcancel', (e) => {
          for (const t of e.changedTouches) {
            if (t.identifier !== active.id) continue;
            if (endFn) endFn(t.identifier);
            active.id = null;
            break;
          }
        }, { passive: false });
      }

      // Optional fallback bindings (only used when pointer events don't fire)
      bindTouchFallback(joystick,
        (id, x, y) => beginMove(`touch-${id}`, x, y),
        (_id, x, y) => {
          if (movePointerId === `touch-${_id}`) updateMove(x, y);
        },
        (_id) => {
          if (movePointerId === `touch-${_id}`) stopMove();
        }
      );

      bindTouchFallback(lookPad,
        (id, x, y) => beginLook(`touch-${id}`, x, y),
        (_id, x, y) => {
          if (lookPointerId === `touch-${_id}`) applyLookMove(x, y);
        },
        (_id) => {
          if (lookPointerId === `touch-${_id}`) stopLook();
        }
      );
    }

    bindStart();
    if (isMobile) bindMobile();
    bindDesktop();

    let last = performance.now();
    function animate(now) {
      requestAnimationFrame(animate);
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;

      if (!running) {
        renderer.render(scene, camera);
        return;
      }

      if (input.mine) {
        mineNow();
        input.mine = false;
      }
      if (input.place) {
        placeNow();
        input.place = false;
      }

      let sx = input.strafe;
      let sz = input.forward;
      const mag = Math.hypot(sx, sz);
      if (mag > 1) {
        sx /= mag;
        sz /= mag;
      }

      if (sx || sz) {
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(player.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(player.quaternion);
        const mv = new THREE.Vector3();
        mv
          .addScaledVector(forward, sz)
          .addScaledVector(right, sx)
          .normalize();
        mv.y = 0;
        player.position.addScaledVector(mv, cfg.moveSpeed * dt);
      }

      if (input.jump && onGround) {
        vy = cfg.jumpSpeed;
        onGround = false;
      }
      input.jump = false;

      vy += cfg.gravity * dt;
      player.position.y += vy * dt;

      const g = groundHeightAt(player.position.x, player.position.z);
      const floorY = g === null ? -Infinity : (g + cfg.eyeHeight);

      if (g !== null && player.position.y <= floorY) {
        player.position.y = floorY;
        vy = 0;
        onGround = true;
      } else if (g !== null && player.position.y > floorY + 0.12) {
        onGround = false;
      }

      if (player.position.y < -100) {
        player.position.set(0, cfg.eyeHeight, 10);
        vy = 0;
        onGround = true;
      }

      renderer.render(scene, camera);
    }
    requestAnimationFrame(animate);

    addEventListener('resize', () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    });
  
