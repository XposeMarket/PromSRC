# Environment texture atlas

`environment-atlas.jpg` is the 768×768 Vita runtime asset packed at `app0:assets/environment-atlas.jpg`.

`environment-atlas-source.png` is the first four-material source. `environment-atlas-source-v2.png` is the active full-resolution 3×3 imagegen source: grass, asphalt, sidewalk, brick, church stone, architectural glass, bench wood, brushed metal, and daytime sky.

Generated with the built-in image generation tool using this production prompt:

> A square 3×3 PS Vita driving-game material atlas with nine perfectly separated equal cells: park grass, fine-aggregate asphalt, sidewalk concrete, red-brown brick, church stone, modern architectural glass, outdoor bench wood, brushed metal, and cheerful daytime sky. Stylized-realistic early-2000s console finish, flat orthographic materials, even daylight, no text, objects, perspective, shadows, borders, or watermarks.

The runtime JPEG was mechanically downscaled and saved at quality 82. Geometry, damage, HUD, prop physics, and driving remain code-native.

## Cockpit dashboard

`cockpit-dashboard-source.png` is the full-resolution built-in imagegen source. `cockpit-dashboard.jpg` is the cropped 960×230 Vita runtime overlay packed at `app0:assets/cockpit-dashboard.jpg`; the animated steering wheel and live windshield view remain code-native.

Final prompt:

> A polished semi-realistic PS Vita-era sports-car dashboard fascia for the lower portion of a 16:9 first-person view: matte charcoal molded dashboard, subtle red stitching, left-driver instrument binnacle, believable vents and center console, restrained gunmetal highlights, soft daylight, and a low unobstructed dashboard silhouette. No steering wheel, hands, seats, exterior scenery, brands, readable text, or watermark.
