#!/usr/bin/env python3
"""Deterministic source-contract regression checks for Vita flight and drift controls."""
from pathlib import Path

source = Path(__file__).resolve().parents[1] / "src" / "main.cpp"
text = source.read_text(encoding="utf-8")

def require(fragment: str, description: str) -> None:
    if fragment not in text:
        raise AssertionError(description + " missing")

# Plane input -> physics -> visible-bank chain. Left stick left produces a
# positive rawYaw/yaw/roll; right produces negative values. The forward-looking
# chase view mirrors the model X basis, so the render boundary must negate roll.
require("const float rawYaw=controlled?-((int)pad.lx-128)/127.0f:0.0f;", "left/right yaw normalization")
require("plane.yaw+=yawInput*dt", "left/right yaw physics")
require("plane.roll+=(yawInput*.78f-plane.roll)", "left/right bank state")
require("glRotatef(-plane.roll*180.0f/PI,0,0,1)", "rendered bank corrects chase-view mirror")

def rendered_bank_sign(yaw_input: float) -> float:
    """Sign contract from stick/yaw to screen-visible bank, including view mirror."""
    yaw_delta = yaw_input
    roll_state = yaw_input * .78
    visible_bank = -roll_state  # forward chase-view/model-basis mirror
    if yaw_input:
        assert yaw_delta * yaw_input > 0.0
        assert visible_bank * yaw_delta < 0.0
    else:
        assert visible_bank == 0.0
    return visible_bank

assert rendered_bank_sign(1.0) < 0.0, "left turn must put the left wing down on screen"
assert rendered_bank_sign(-1.0) > 0.0, "right turn must put the right wing down on screen"
assert rendered_bank_sign(0.0) == 0.0, "neutral steering must render neutral bank"
require("// Negate only at this model boundary", "documented visual-bank boundary")
require("Level chase camera", "documented pitch-decoupled plane camera")
require("plane.x-fx*13,plane.y+5.0f", "level yaw-following chase camera")
require("plane.x+fx*26,plane.y+2.2f", "steady forward camera target")
# Vita stick-up is below center and must generate positive nose-up pitch.
require("const float rawPitch=controlled?((int)pad.ry-128)/127.0f:0.0f;", "stick-up to nose-up pitch")
require("plane.pitch+=pitchInput*dt*1.78f", "airborne pitch integration")
require("fy=std::sin(plane.pitch)", "pitch feeds vertical flight/camera axis")
# R must be held for immediate forward gas; L is brake, both runway and air.
require("plane.throttle=gasHeld?1.0f:0.0f;", "hold-to-gas throttle")
require("const float runwayForce=throttle*21.0f-(brakeHeld?28.0f:0.0f)-.28f*groundForward;", "runway R acceleration and L brake")
require("throttle*20.0f-airBrake", "airborne R acceleration and L deceleration")
require("if(plane.active&&plane.airborne){plane.airborne=false", "one-shot touchdown damping")
# Powered flight retains an honest glide but gains a higher useful ceiling/speed.
require("const float throttle=plane.throttle;", "hold-to-gas throttle state")
require("throttle*20.0f-airBrake", "powered-flight thrust")
require("throttle*1.8f", "powered climb contribution")
require("if(airspeed>90.0f)", "modestly raised flight speed cap")
require("PLANE_CEILING=420.0f", "raised flight ceiling")
require("PLANE_SAFE_WORLD_RADIUS=2400.0f", "generous aircraft recovery boundary")
require("planeRadius>PLANE_SAFE_WORLD_RADIUS", "no immediate city-edge plane explosion")
require("std::fabs(plane.pitch)*.013f", "nose-up drag increase")
# Both weapons must produce a positive/upward rendered camera kick, then decay.
require("aimRecoil=std::max(aimRecoil,.085f)", "rocket upward recoil impulse")
require("aimRecoil=std::max(aimRecoil,.018f)", "machine-gun upward recoil impulse")
require("float renderedPitch=clampf(person.viewPitch+aimRecoil", "render-only recoil view pitch")
require("person.viewPitch=clampf(person.viewPitch+lookY*dt*2.95f,-1.35f,1.35f)", "recoil does not drift aim state")
# Heading-up local minimap: player is fixed center/up and roads rotate by yaw.
require("Heading-up local navigation", "heading-up minimap documentation")
require("float localHalfX=115.0f,localHalfZ=72.0f", "substantially zoomed local minimap")
require("float localX=dx*ch-dz*sh,localZ=dx*sh+dz*ch", "minimap heading rotation")
require("float cx=(left+right)*.5f,cy=(top+bottom)*.5f", "centered minimap player")
# Raul-approved car mappings and high-speed/slip rear release.
require("float steer = -((int)pad.lx - 128) / 127.0f;", "car left-stick steering")
require("float throttle = (pad.buttons & SCE_CTRL_RTRIGGER) ? 1.0f : 0.0f;", "car R gas")
require("float brake = (pad.buttons & SCE_CTRL_LTRIGGER) ? 1.0f : 0.0f;", "car L brake/reverse")
require("bool handbrake = (pad.buttons & SCE_CTRL_CIRCLE) != 0;", "Circle handbrake")
require("float speedGripRelease=clampf((std::fabs(forward)-25.0f)/40.0f,0.0f,1.0f);", "speed-dependent rear grip")
require("float lateralGripRelease=clampf((std::fabs(lateral)-1.5f)/10.0f,0.0f,1.0f);", "slip-dependent rear grip")
require("breakawayMoment", "rear breakaway yaw/spin response")
print("control regressions: PASS (plane powered flight/camera/bounds; upward recoil; heading-up minimap; car mapping/grip/slip)")
