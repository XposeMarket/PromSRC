import * as THREE from 'three';

export function createOrbitCamera(camera, target) {
  const spherical = new THREE.Spherical(12, Math.PI * 0.42, 0);
  const fpsEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  return {
    update(mode, ship, lookDelta, dt, shipState) {
      const sens = mode === 'galaxy' ? 0.004 : 0.0032;
      if (mode === 'biome' || mode === 'interior') {
        shipState.yaw -= lookDelta.dx * sens;
        shipState.pitch = THREE.MathUtils.clamp(shipState.pitch - lookDelta.dy * sens, -1.35, 1.35);
        fpsEuler.set(shipState.pitch, shipState.yaw, 0);
        const eye = new THREE.Vector3(0, 1.65, 0);
        eye.applyEuler(fpsEuler);
        const pos = ship.position.clone().add(eye);
        camera.position.copy(pos);
        const lookTarget = pos.clone().add(new THREE.Vector3(0, 0, -1).applyEuler(fpsEuler));
        camera.lookAt(lookTarget);
        return;
      }

      spherical.theta -= lookDelta.dx * sens;
      spherical.phi = THREE.MathUtils.clamp(spherical.phi - lookDelta.dy * sens, 0.12, Math.PI * 0.55);
      spherical.radius = 12;

      if (shipState) {
        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);
        shipState.pitch = THREE.MathUtils.clamp(
          THREE.MathUtils.lerp(shipState.pitch, -Math.asin(THREE.MathUtils.clamp(camDir.y, -1, 1)), 1 - Math.pow(0.08, dt)),
          -0.75,
          0.75,
        );
        ship.rotation.order = 'YXZ';
        ship.rotation.y = shipState.yaw;
        ship.rotation.x = shipState.pitch;
        ship.rotation.z = THREE.MathUtils.lerp(ship.rotation.z, 0, 1 - Math.pow(0.12, dt));
      }

      const pos = new THREE.Vector3().setFromSpherical(spherical);
      pos.add(ship.position);
      camera.position.lerp(pos, 1 - Math.pow(0.001, dt));
      camera.lookAt(ship.position.x, ship.position.y + 1.0, ship.position.z);
    },
    resetBehind(yaw) {
      spherical.theta = yaw + Math.PI;
      spherical.phi = Math.PI * 0.42;
    },
    resetFps(yaw) {
      spherical.theta = yaw + Math.PI;
    },
  };
}