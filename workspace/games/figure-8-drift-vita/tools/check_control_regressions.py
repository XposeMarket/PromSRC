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
require("float upx=ux*cr-rx*sr", "bank-aware chase-camera up vector")
require("plane.x-fx*12+upx*3.5f", "locked behind-and-above chase camera")
# Vita stick-up is below center and must generate positive nose-up pitch.
require("const float rawPitch=controlled?((int)pad.ry-128)/127.0f:0.0f;", "stick-up to nose-up pitch")
require("plane.pitch+=pitchInput*dt*1.55f", "airborne pitch integration")
require("fy=std::sin(plane.pitch)", "pitch feeds vertical flight/camera axis")
# R must be held for immediate forward gas; L is brake, both runway and air.
require("plane.throttle=gasHeld?1.0f:0.0f;", "hold-to-gas throttle")
require("const float runwayForce=throttle*18.0f-(brakeHeld?26.0f:0.0f)-.32f*groundForward;", "runway R acceleration and L brake")
require("throttle*15.0f-airBrake", "airborne R acceleration and L deceleration")
require("if(plane.active&&plane.airborne){plane.airborne=false", "one-shot touchdown damping")
# Glide energy: no automatic gas, pitch affects velocity alignment/lift/drag/gravity.
require("const float throttle=plane.throttle;", "off-gas glide state")
require("plane.vy+=(lift-9.8f)*dt;", "gravity/lift glide exchange")
require("std::fabs(plane.pitch)*.013f", "nose-up drag increase")
# Raul-approved car mappings and high-speed/slip rear release.
require("float steer = -((int)pad.lx - 128) / 127.0f;", "car left-stick steering")
require("float throttle = (pad.buttons & SCE_CTRL_RTRIGGER) ? 1.0f : 0.0f;", "car R gas")
require("float brake = (pad.buttons & SCE_CTRL_LTRIGGER) ? 1.0f : 0.0f;", "car L brake/reverse")
require("bool handbrake = (pad.buttons & SCE_CTRL_CIRCLE) != 0;", "Circle handbrake")
require("float speedGripRelease=clampf((std::fabs(forward)-25.0f)/40.0f,0.0f,1.0f);", "speed-dependent rear grip")
require("float lateralGripRelease=clampf((std::fabs(lateral)-1.5f)/10.0f,0.0f,1.0f);", "slip-dependent rear grip")
require("breakawayMoment", "rear breakaway yaw/spin response")
print("control regressions: PASS (plane directions/gas/brake/camera/glide; car mapping/grip/slip)")
