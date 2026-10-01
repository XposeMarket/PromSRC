# Example: Game Or 3D Work

User request:

> Build a little 3D product configurator.

Execution:

1. Inspect whether the repo already uses Three.js, React Three Fiber, Babylon, or plain canvas.
2. Use the existing 3D stack; otherwise choose Three.js.
3. Make the first screen the configurator, not a product landing page.
4. Implement:
   - full-bleed or primary scene area
   - visible product/object on first frame
   - controls for material/color/view
   - reset and screenshot/download only if natural
   - resize handling
   - loading/error state for assets
5. Verify:
   - nonblank canvas
   - object stays framed on mobile
   - control changes affect the object
   - no console asset errors

For games, use established libraries for rules/physics when the domain is nontrivial. For example, use a chess library for chess legality or a physics engine for collision-heavy games.
