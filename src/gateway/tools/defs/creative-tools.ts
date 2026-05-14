import { filterPublicBuildToolDefs } from '../../../runtime/distribution.js';

const CREATIVE_MODE_ENUM = ['design', 'image', 'canvas', 'video'] as const;

function emptyObjectSchema() {
  return { type: 'object', required: [], properties: {}, additionalProperties: false };
}

export function getCreativeToolDefs() {
  const tools = [
    {
      type: 'function',
      function: {
        name: 'get_creative_mode',
        description: 'Return the selected Creative editor workspace for this session, if any.',
        parameters: emptyObjectSchema(),
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_list_references',
        description: 'List the session Creative References bucket populated from fetched/downloaded media. Use this during creative work to recover exact reference images, video frame paths, source URLs, authority, intent, and analysis notes before deciding visual direction.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            limit: { type: 'number', description: 'Maximum references to return. Defaults 20.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'switch_creative_mode',
        description:
          'Select the persistent Creative editor workspace for this session, or pass mode:null to clear it. This is editor state only; it does not change assistant runtime, prompt profile, history, or non-creative tool availability. Use image for editable canvas/workspace, video for motion/video work, and design for live HTML/app design. Do not use this for one-shot AI image generation; use generate_image for GPT image models such as gpt-image-2.',
        parameters: {
          type: 'object',
          required: ['mode'],
          properties: {
            mode: { type: ['string', 'null'], enum: [...CREATIVE_MODE_ENUM, null], description: 'Creative workspace to select, or null to clear the workspace. canvas is accepted as a legacy alias for image.' },
            reason: { type: 'string', description: 'Short reason for the workspace selection.' },
            initialIntent: { type: 'string', description: 'Optional creative objective to carry into the workspace.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
        type: 'function',
        function: {
          name: 'creative_get_state',
          description:
            'Ask the active creative editor for the latest scene/timeline state. The runtime also renders current frame samples and injects those actual images into the next model step when vision is available, so the creative agent sees its own work directly.',
          parameters: emptyObjectSchema(),
        },
      },
    {
      type: 'function',
      function: {
        name: 'creative_apply_ops',
        description:
          'Apply deterministic scene-graph operations to the active Image workspace. Removed from Video mode; use HTML Motion, HyperFrames, Remotion templates, and Pretext QA tools for video work.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            ops: {
              type: 'array',
              description: 'Scene graph operations such as add, set, move, resize, delete, swap-icon, add-keyframe, set-keyframes, add-animation-preset.',
              items: { type: 'object' },
            },
            operations: {
              type: 'array',
              description: 'Alias for ops. Natural op names such as set_canvas, update_element, add_element, and delete_element are accepted and normalized.',
              items: { type: 'object' },
            },
            reason: { type: 'string', description: 'Short explanation of why these ops are being applied.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_select_element',
        description: 'Select an element in the active creative editor so subsequent edits and context focus on it.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Element id to select.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_set_canvas',
        description: 'Set Image canvas/document properties such as width, height, and background. Removed from Video mode; set video dimensions/duration through HTML Motion, HyperFrames, or Remotion template inputs.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            width: { type: 'number' },
            height: { type: 'number' },
            background: { type: 'string' },
            durationMs: { type: 'number' },
            frameRate: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_add_element',
          description: 'Add a text, shape, icon, image, video, or group element to the active Image workspace. Removed from Video mode; author video visuals as HTML Motion/HyperFrames/Remotion instead of primitive scene layers.',
          parameters: {
            type: 'object',
            required: ['type'],
            properties: {
              type: { type: 'string', enum: ['text', 'shape', 'icon', 'image', 'video', 'group'] },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
            rotation: { type: 'number' },
            opacity: { type: 'number' },
            zIndex: { type: 'number' },
              meta: { type: 'object', description: 'Type-specific properties: content/fontFamily/fontSize/fontWeight/color for text, shape/fill/stroke for shape, any Iconify iconName/color for icon, src/source/fit for image, source/fit/trim/timeline/volume for video.' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_add_asset',
          description: 'Place an uploaded workspace image or video file as an editable Image/canvas asset layer. Removed from Video mode; import assets for use inside HTML Motion, HyperFrames, or Remotion inputs instead.',
          parameters: {
            type: 'object',
            required: ['source'],
            properties: {
              source: { type: 'string', description: 'Exact workspace path, URL, or data URL for the image/video asset.' },
              assetType: { type: 'string', enum: ['auto', 'image', 'video'], description: 'Defaults to auto from the file extension.' },
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
              rotation: { type: 'number' },
              opacity: { type: 'number' },
              zIndex: { type: 'number' },
              fit: { type: 'string', enum: ['cover', 'contain', 'fill', 'auto'] },
              radius: { type: 'number' },
              startMs: { type: 'number', description: 'Video layer timeline start in milliseconds.' },
              durationMs: { type: 'number', description: 'Video layer timeline duration in milliseconds.' },
              trimStartMs: { type: 'number' },
              trimEndMs: { type: 'number' },
              muted: { type: 'boolean' },
              volume: { type: 'number' },
              meta: { type: 'object' },
            },
            additionalProperties: false,
          },
        },
      },
    {
      type: 'function',
      function: {
        name: 'creative_import_asset',
        description: 'Import a local workspace image/video/audio/SVG/Lottie asset into the Creative asset library, analyze it, and add it to the searchable asset index. Use before placing reusable footage, screenshots, overlays, mockups, or brand files.',
          parameters: {
            type: 'object',
            required: ['source'],
            properties: {
              source: { type: 'string', description: 'Workspace path, absolute workspace-contained path, or remote URL to register.' },
              filename: { type: 'string', description: 'Optional library filename when copying a local file.' },
              tags: { type: ['array', 'string'], items: { type: 'string' }, description: 'Tags such as dashboard, b-roll, background, overlay, logo, brand.' },
              brandId: { type: 'string' },
              license: { type: 'object' },
              copy: { type: 'boolean', description: 'Copy local files into the creative asset library. Defaults true.' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_extract_layers',
          description:
            'Convert a flat uploaded or generated image into an editable Prometheus Image scene. It preserves the source raster as a locked reference layer, prioritizes visual panel/shape/object candidate layers, saves a scene JSON file, and can apply the result directly to the active Image workspace. OCR text extraction is opt-in because it can hallucinate on image texture.',
          parameters: {
            type: 'object',
            required: ['source'],
            properties: {
              source: { type: 'string', description: 'Workspace path or absolute workspace-contained path to the source image.' },
              mode: { type: 'string', enum: ['fast', 'balanced', 'deep'], description: 'fast keeps the source layer and uses vision only; balanced proposes visual structure; deep requests richer object/panel candidates.' },
              prompt: { type: 'string', description: 'Optional original image generation prompt or user intent to help semantic layer detection.' },
              textEditable: { type: 'boolean', description: 'Allow visible text to become editable text layers. Defaults false.' },
              extractObjects: { type: 'boolean', description: 'Ask for major object/photo candidate layers. Defaults true.' },
              preserveOriginal: { type: 'boolean', description: 'Keep the original raster as a locked full-canvas reference/background layer. Defaults true.' },
              applyToScene: { type: 'boolean', description: 'Apply the extracted scene to the active Image workspace. Defaults true.' },
              replaceScene: { type: 'boolean', description: 'Reset the current Image scene before applying extracted layers. Defaults true.' },
                copySource: { type: 'boolean', description: 'Copy the image into the Creative asset library before extraction. Defaults true.' },
                useVision: { type: 'boolean', description: 'Use configured OpenAI vision analysis for semantic layer proposals when available. Defaults true.' },
                useOcr: { type: 'boolean', description: 'Run Tesseract OCR as an extra text-layer pass. Defaults false and should only be enabled for clean, text-heavy graphics.' },
                useSam: { type: 'boolean', description: 'Use local SAM segmentation to create transparent object cutout layers when models are installed. Defaults true.' },
                inpaintBackground: { type: 'boolean', description: 'Generate a clean-plate background with LaMa/flat-fill. Defaults true so extracted layers can be moved while the initial image still looks intact.' },
                vectorTraceShapes: { type: 'boolean', description: 'Vector-trace simple shape regions when possible. Defaults true.' },
                maxTextLayers: { type: 'number', description: 'Maximum editable text layers to create.' },
                maxShapeLayers: { type: 'number', description: 'Maximum shape/object candidate layers to create.' },
              },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_analyze_asset',
          description: 'Analyze a creative media asset and upsert metadata into the asset index: kind, MIME, dimensions, duration, frame rate, codec, alpha, thumbnail, tags, and license metadata.',
          parameters: {
            type: 'object',
            required: ['source'],
            properties: {
              source: { type: 'string' },
              tags: { type: ['array', 'string'], items: { type: 'string' } },
              brandId: { type: 'string' },
              license: { type: 'object' },
              force: { type: 'boolean' },
              upsert: { type: 'boolean', description: 'Write analysis to the asset index. Defaults true.' },
            },
            additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_attach_audio_from_url',
        description: 'Download audio from a supported media URL with yt-dlp, import it into the Creative asset library, analyze waveform/metadata, and attach it as the active Video Mode audio lane. Use when the user provides a YouTube/X/TikTok/Instagram/media URL or asks to use a song/voiceover from the web as background audio. Only use with media the user has rights or permission to use.',
        parameters: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string', description: 'Supported page/media URL, such as a YouTube video URL.' },
            label: { type: 'string', description: 'Optional audio lane label.' },
            startMs: { type: 'number', description: 'Timeline start time for the audio lane. Defaults 0.' },
            durationMs: { type: 'number', description: 'Optional active duration on the timeline. Defaults to source duration when known.' },
            trimStartMs: { type: 'number', description: 'Milliseconds to trim from the beginning of the downloaded audio.' },
            trimEndMs: { type: 'number', description: 'Milliseconds to trim from the end of the downloaded audio.' },
            volume: { type: 'number', description: 'Audio volume from 0 to 1. Defaults 1.' },
            fadeInMs: { type: 'number', description: 'Fade-in duration in milliseconds.' },
            fadeOutMs: { type: 'number', description: 'Fade-out duration in milliseconds.' },
            tags: { type: ['array', 'string'], items: { type: 'string' }, description: 'Optional asset tags. Defaults include audio and background-music.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_attach_audio_from_file',
        description: 'Attach audio from a local workspace file to the active Video Mode timeline. If the source is a video file, extract its audio with FFmpeg first; if it is already audio, import and analyze it directly. Use when the user uploads/sends a TikTok/video/audio file and asks to reuse its background sound, music, or voiceover.',
        parameters: {
          type: 'object',
          required: ['source'],
          properties: {
            source: { type: 'string', description: 'Workspace-relative or workspace-contained absolute path to a local video/audio file.' },
            label: { type: 'string', description: 'Optional audio lane label.' },
            startMs: { type: 'number', description: 'Timeline start time for the audio lane. Defaults 0.' },
            durationMs: { type: 'number', description: 'Optional active duration on the timeline. Defaults to source duration when known.' },
            trimStartMs: { type: 'number', description: 'Milliseconds to trim from the beginning of the audio.' },
            trimEndMs: { type: 'number', description: 'Milliseconds to trim from the end of the audio.' },
            volume: { type: 'number', description: 'Audio volume from 0 to 1. Defaults 1.' },
            fadeInMs: { type: 'number', description: 'Fade-in duration in milliseconds.' },
            fadeOutMs: { type: 'number', description: 'Fade-out duration in milliseconds.' },
            tags: { type: ['array', 'string'], items: { type: 'string' }, description: 'Optional asset tags. Defaults include audio and extracted-audio.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_search_assets',
          description: 'Search the Creative asset index for usable video mode media, including imported footage, screenshots, overlays, SVGs, audio, Lottie animations, generated plates, scenes, and exports.',
          parameters: {
            type: 'object',
            required: [],
            properties: {
              query: { type: 'string', description: 'Search words such as dashboard, background, phone, founder, logo, texture, overlay, music.' },
              kinds: { type: 'array', items: { type: 'string', enum: ['image', 'video', 'audio', 'lottie', 'svg', 'model', 'document', 'other', 'remote'] } },
              tags: { type: ['array', 'string'], items: { type: 'string' } },
              brandId: { type: 'string' },
              limit: { type: 'number', description: 'Defaults 50, max 200.' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_generate_asset',
          description: 'Generate a placement-ready editable Creative asset record. Current local implementation creates a branded SVG background plate placeholder and stores it in the Creative asset index; provider-backed image/video generation can replace this later without changing the tool contract.',
          parameters: {
            type: 'object',
            required: ['prompt'],
            properties: {
              prompt: { type: 'string', description: 'Description of the graphic asset, background plate, texture, mockup, or overlay to create.' },
              width: { type: 'number' },
              height: { type: 'number' },
              kind: { type: 'string', enum: ['image', 'svg'] },
              tags: { type: ['array', 'string'], items: { type: 'string' } },
              brandId: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_render_ascii_asset',
          description:
            'Render premium source-driven ASCII / terminal-cinema footage with the bundled Python + ffmpeg lane, import the MP4 into the Creative asset library, and optionally place it as a selectable video layer in the active Video canvas. Use this for high-quality nous-ascii-video style results instead of hand-drawn HTML glyph effects.',
          parameters: {
            type: 'object',
            required: [],
            properties: {
              source: { type: 'string', description: 'Workspace image/video path to convert into ASCII. Omit only when mode is generative.' },
              mode: { type: 'string', enum: ['image-to-ascii', 'video-to-ascii', 'audio-reactive', 'generative', 'hybrid'], description: 'Render mode. Defaults from source type.' },
              width: { type: 'number', description: 'Output width in pixels. Defaults 1080.' },
              height: { type: 'number', description: 'Output height in pixels. Defaults 1920.' },
              durationMs: { type: 'number', description: 'Output duration. Defaults 6000ms.' },
              frameRate: { type: 'number', description: 'Output frame rate. Defaults 30fps; use 24-30 for heavy ASCII.' },
              quality: { type: 'string', enum: ['draft', 'balanced', 'premium'], description: 'draft is fast, balanced is default, premium increases glyph density/glow.' },
              glyphSet: { type: 'string', enum: ['ascii', 'binary', 'blocks', 'matrix', 'braille', 'dense'], description: 'Glyph ramp/style. dense gives the most cinematic source detail.' },
              palette: {
                type: ['string', 'array'],
                items: { type: 'string' },
                description: 'Color palette: nous-cyan-magenta, phosphor-green, amber, mono, source, or custom hex colors.',
              },
              style: { type: 'string', description: 'Style hint saved into render metadata.' },
              motion: { type: 'string', enum: ['resolve', 'scan', 'hold'], description: 'Reveal/motion treatment for the glyph field.' },
              fit: { type: 'string', enum: ['cover', 'contain'], description: 'How the source is fitted into the output frame.' },
              background: { type: 'string', description: 'Background color hex.' },
              glitch: { type: 'number', description: '0-1 glitch amount.' },
              glow: { type: 'number', description: '0-1 glyph glow amount.' },
              seed: { type: 'number' },
              filename: { type: 'string', description: 'Optional imported asset filename base.' },
              tags: { type: ['array', 'string'], items: { type: 'string' } },
              brandId: { type: 'string' },
              license: { type: 'object' },
              importToCreative: { type: 'boolean', description: 'Import rendered MP4 into the Creative asset library. Defaults true.' },
              keepFrames: { type: 'boolean', description: 'Keep temporary PNG frame sequence for debugging. Defaults false.' },
              timeoutMs: { type: 'number', description: 'Optional render timeout override.' },
              placeInScene: { type: 'boolean', description: 'When true, place the imported MP4 as an editable/selectable video asset layer in the active Creative workspace.' },
              x: { type: 'number' },
              y: { type: 'number' },
              layerWidth: { type: 'number' },
              layerHeight: { type: 'number' },
              layerFit: { type: 'string', enum: ['cover', 'contain', 'fill', 'auto'] },
              startMs: { type: 'number' },
              layerDurationMs: { type: 'number' },
              muted: { type: 'boolean' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_add_effect',
          description: 'Add an editable effect to an Image/canvas element effect stack, such as blur, brightness, contrast, saturate, hue-rotate, or drop-shadow. Removed from Video mode; encode effects in HTML/CSS/JS or Remotion.',
          parameters: {
            type: 'object',
            required: ['id', 'type'],
            properties: {
              id: { type: 'string', description: 'Target element id.' },
              type: { type: 'string', description: 'Effect type: blur, brightness, contrast, saturate, hue-rotate, drop-shadow.' },
              startMs: { type: 'number' },
              durationMs: { type: 'number' },
              params: { type: 'object', description: 'Effect parameters. Use from/to for animated scalar effects, or x/y/radius/color for drop-shadow.' },
              enabled: { type: 'boolean' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_set_blend_mode',
          description: 'Set CSS/canvas blend mode for an Image/canvas element. Removed from Video mode; use HTML/CSS compositing or Remotion instead.',
          parameters: {
            type: 'object',
            required: ['id', 'blendMode'],
            properties: {
              id: { type: 'string' },
              blendMode: { type: 'string', enum: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'] },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_add_mask',
          description: 'Add or replace an editable clipping mask on an Image/canvas element. Removed from Video mode; use CSS masks/clips in HTML Motion or Remotion composition code instead.',
          parameters: {
            type: 'object',
            required: ['id', 'mask'],
            properties: {
              id: { type: 'string' },
              mask: { type: 'object', description: 'Mask object with type rect, rounded-rect, ellipse, circle, polygon, path, or inset plus radius/points/path.' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_trim_clip',
          description: 'Set timeline clip timing for an Image/canvas element. Removed from Video mode; use HTML Motion timing attributes, Remotion sequencing, or composition clip trimming instead.',
          parameters: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string' },
              startMs: { type: 'number' },
              endMs: { type: 'number' },
              durationMs: { type: 'number' },
              trimStartMs: { type: 'number' },
              trimEndMs: { type: 'number' },
              speed: { type: 'number' },
              loop: { type: 'boolean' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_apply_brand_kit',
          description: 'Attach a persistent brand kit to an Image/canvas scene and optionally apply its colors/fonts. Removed from Video mode; pass brand values into HTML Motion, HyperFrames, or Remotion template inputs instead.',
          parameters: {
            type: 'object',
            required: ['brandKit'],
            properties: {
              brandKit: {
                type: 'object',
                description: 'Brand kit with id, name, colors {primary, secondary, accent, background, text}, fonts {heading, body}, logo, motion, and reusable component metadata.',
              },
              applyToScene: { type: 'boolean', description: 'If true, apply brand background/basic styles to existing layers where safe. Defaults true.' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_search_icons',
        description: 'Search the full Iconify catalog for icon names that can be used as meta.iconName in creative_add_element or creative_update_element. In Video mode, use this for meaningful symbols, UI marks, tech/product metaphors, CTA arrows, and social/video accents instead of drawing random decorative rectangles.',
        parameters: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', description: 'Search phrase or Iconify prefix/name, e.g. star, arrow right, lucide:camera, solar:play.' },
            limit: { type: 'number', description: 'Maximum icons to return. Defaults 24, max 64.' },
          },
          additionalProperties: false,
        },
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_search_animations',
          description: 'Search available built-in and enabled custom scene-graph animation preset ids for Image/canvas work. Removed from Video mode; use HTML/CSS/JS timing, HyperFrames blocks, or Remotion animation systems instead.',
          parameters: {
            type: 'object',
            required: [],
            properties: {
              query: { type: 'string', description: 'Search phrase such as cinematic, blur, text, entrance, exit, pop, pulse, slide, spin, caption.' },
              target: { type: 'string', enum: ['text', 'shape', 'image', 'video', 'icon', 'group'], description: 'Optional element type to filter presets for.' },
              limit: { type: 'number', description: 'Maximum presets to return. Defaults 24, max 64.' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
        name: 'creative_reset_scene',
          description: 'Hard-reset the active creative document to a guaranteed blank Image/Video scene. This is destructive: first save a creative_checkpoint when the scene has any useful work, and use creative_purge_scene for stale layers/template residue before resetting. Only pass force=true when the user explicitly asked for a fresh blank scene or a checkpoint/export has already preserved the work.',
          parameters: {
            type: 'object',
            required: [],
            properties: {
              force: { type: 'boolean', description: 'Required to reset a non-empty scene. Use only after checkpoint/export or explicit user fresh-start instruction.' },
              reason: { type: 'string', description: 'Short reason for the destructive reset.' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_purge_scene',
          description: 'Remove stale/unsafe layers from the current creative scene, such as hidden layers, offscreen layers, empty text, and duplicate ids. Use before rebuilding or exporting.',
          parameters: {
            type: 'object',
            required: [],
            properties: {
              targets: {
                type: 'array',
                items: { type: 'string', enum: ['hidden', 'offscreen', 'empty_text', 'duplicate_ids'] },
                description: 'Defaults to hidden, offscreen, empty_text, and duplicate_ids.',
              },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_element_inventory',
          description: 'Return a full element inventory with text/source/icon values, geometry, z-order, timing windows, keyframes, parent/template provenance, captions, motion templates, and layout validation.',
          parameters: {
            type: 'object',
            required: [],
            properties: {
              includeHidden: { type: 'boolean', description: 'Include hidden/zero-opacity elements. Defaults true.' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_frame_trace',
          description: 'Inspect which elements are active/rendered at exact video timestamp(s), including resolved opacity, geometry, z-order, timing, and template provenance. Use when a frame visually contains unexpected content.',
          parameters: {
            type: 'object',
            required: [],
            properties: {
              atMs: { type: 'number', description: 'Single timestamp to inspect.' },
              timesMs: { type: 'array', items: { type: 'number' }, description: 'Batch timestamps to inspect.' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_frame_diff',
          description: 'Compare active/rendered element state between two video timestamps. Use to detect what changed between frames or why sampled frames look static.',
          parameters: {
            type: 'object',
            required: [],
            properties: {
              leftAtMs: { type: 'number' },
              rightAtMs: { type: 'number' },
              fromMs: { type: 'number', description: 'Alias for leftAtMs.' },
              toMs: { type: 'number', description: 'Alias for rightAtMs.' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_history_status',
          description:
            'Inspect Creative undo/redo availability and current scene summary. Use after risky edits, failed resets, or confusing visual state to decide whether undo/redo/checkpoint restore can recover the work.',
          parameters: emptyObjectSchema(),
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_undo',
          description:
            'Undo the most recent Creative scene change using the editor history. Use immediately after a destructive reset, bad template application, failed batch edit, or visual regression. After undoing, render or inspect the scene before continuing.',
          parameters: {
            type: 'object',
            required: [],
            properties: {
              reason: { type: 'string', description: 'Short reason for undoing the last creative edit.' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_redo',
          description:
            'Redo the most recently undone Creative scene change. Use only when an undo went too far or the user asks to reapply the undone edit.',
          parameters: {
            type: 'object',
            required: [],
            properties: {
              reason: { type: 'string', description: 'Short reason for redoing the creative edit.' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_checkpoint',
          description: 'Save or restore a creative scene version checkpoint before/after risky edits. Use action=save before major rebuilds and action=restore to roll back.',
          parameters: {
            type: 'object',
            required: [],
            properties: {
              action: { type: 'string', enum: ['save', 'restore'], description: 'Defaults to save.' },
              id: { type: 'string', description: 'Checkpoint id to restore. Defaults to latest when restoring.' },
              label: { type: 'string', description: 'Optional checkpoint label.' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_export_trace',
          description: 'Return export/render trace data: current scene hash, active export state, recent exports, render jobs, current scene summary, and validation. Use after bad exports or before final delivery.',
          parameters: emptyObjectSchema(),
        },
      },
      {
        type: 'function',
        function: {
          name: 'video_render_frame',
          description: 'Render one actual Video Mode canvas frame at an exact timestamp and inject it for visual review. Alias for creative_render_snapshot with atMs.',
          parameters: {
            type: 'object',
            required: ['atMs'],
            properties: {
              atMs: { type: 'number', description: 'Timestamp in milliseconds.' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'video_render_contact_sheet',
          description: 'Render multiple actual Video Mode frames at selected timestamps for contact-sheet style visual QA.',
          parameters: {
            type: 'object',
            required: [],
            properties: {
              sampleTimesMs: { type: 'array', items: { type: 'number' }, description: 'Frame timestamps in milliseconds. Defaults to start/middle/end.' },
              maxFrames: { type: 'number' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'video_analyze_frame',
          description: 'Render and visually analyze a Video Mode frame at an exact timestamp. Use when a frame looks questionable or needs semantic review.',
          parameters: {
            type: 'object',
            required: [],
            properties: {
              atMs: { type: 'number', description: 'Timestamp in milliseconds. Defaults to current playhead.' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'video_analyze_timeline',
          description: 'Analyze the active Video Mode timeline: inventory, validation, keyframes, captions, audio sync, frame traces, and frame diffs.',
          parameters: {
            type: 'object',
            required: [],
            properties: {
              sampleTimesMs: { type: 'array', items: { type: 'number' }, description: 'Optional timestamps to trace.' },
              includeHidden: { type: 'boolean' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'video_check_keyframes',
          description: 'Check keyframe health across the active Video Mode scene, including duplicate times, no-op motion, single-keyframe tracks, and out-of-range keyframes.',
          parameters: emptyObjectSchema(),
        },
      },
      {
        type: 'function',
        function: {
          name: 'video_check_caption_timing',
          description: 'Check text/caption timing for short durations, dense captions, overlapping caption windows, and pacing risks.',
          parameters: emptyObjectSchema(),
        },
      },
      {
        type: 'function',
        function: {
          name: 'video_check_audio_sync',
          description: 'Check Video Mode audio track timing against scene duration and caption state, including muted audio, late starts, and early endings.',
          parameters: emptyObjectSchema(),
        },
      },
      {
        type: 'function',
        function: {
          name: 'video_extract_clip_frames',
          description: 'Extract/render a dense sequence of Video Mode canvas frames between timestamps for playback inspection.',
          parameters: {
            type: 'object',
            required: [],
            properties: {
              startMs: { type: 'number' },
              endMs: { type: 'number' },
              frameStepMs: { type: 'number', description: 'Milliseconds between sampled frames.' },
              sampleEveryFrame: { type: 'boolean', description: 'If true, sample at the scene frame rate.' },
              maxFrames: { type: 'number' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'video_analyze_imported_video',
          description: 'Analyze an uploaded/imported video file with the video analysis pipeline before using it in Video Mode.',
          parameters: {
            type: 'object',
            required: ['file_path'],
            properties: {
              file_path: { type: 'string', description: 'Local workspace video path.' },
              prompt: { type: 'string' },
              sample_count: { type: 'number' },
              output_dir: { type: 'string' },
              extract_audio: { type: 'boolean' },
              transcribe: { type: 'boolean' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'image_get_element_at_point',
          description: 'Return the topmost and all creative elements at a canvas coordinate. Use for precise hit-testing and fixing a visual area.',
          parameters: {
            type: 'object',
            required: ['x', 'y'],
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              atMs: { type: 'number', description: 'Optional timestamp for animated/video scenes.' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'image_get_overlaps',
          description: 'Return deterministic element overlap pairs with overlap ratios and severity.',
          parameters: {
            type: 'object',
            required: [],
            properties: {
              threshold: { type: 'number', description: 'Minimum overlap ratio against the smaller element. Defaults 0.02.' },
              atMs: { type: 'number', description: 'Optional timestamp for animated/video scenes.' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'image_get_bounds_summary',
          description: 'Return canvas bounds, element bounds, union bounds, and off-canvas element summary.',
          parameters: {
            type: 'object',
            required: [],
            properties: {
              includeHidden: { type: 'boolean', description: 'Include hidden/zero-opacity elements. Defaults true.' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'image_check_text_overflow',
          description: 'Measure text boxes and report vertical overflow, broken line wraps, and long-word/narrow-box risks.',
          parameters: emptyObjectSchema(),
        },
      },
      {
        type: 'function',
        function: {
          name: 'image_check_contrast',
          description: 'Check simple solid text foreground/background contrast ratios for readable canvas text.',
          parameters: emptyObjectSchema(),
        },
      },
      {
        type: 'function',
        function: {
          name: 'image_detect_empty_regions',
          description: 'Detect large empty grid regions on the canvas to help improve composition and balance.',
          parameters: {
            type: 'object',
            required: [],
            properties: {
              rows: { type: 'number' },
              cols: { type: 'number' },
              minAreaRatio: { type: 'number' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_list_motion_templates',
          description: 'List Remotion-backed Creative Motion templates and social/video presets such as Caption Reel, Audio Visualizer, and Product Promo.',
          parameters: emptyObjectSchema(),
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_preview_motion_template',
          description: 'Create a Remotion motion-template preview from structured inputs before applying it to the active Creative scene.',
          parameters: {
            type: 'object',
            required: ['templateId'],
            properties: {
              templateId: { type: 'string', enum: ['caption-reel-v2', 'caption-reel', 'audio-visualizer', 'product-promo'] },
              presetId: { type: 'string' },
              socialFormat: { type: 'string', enum: ['reel', 'short', 'story', 'square', 'feed45', 'youtube'] },
              title: { type: 'string' },
              subtitle: { type: 'string' },
              caption: { type: 'string', description: 'Plain caption/transcript text. Caption Reel will auto-convert this into timed caption segments when captions.segments is omitted.' },
              captionText: { type: 'string', description: 'Alias for plain caption/transcript text.' },
              cta: { type: 'string' },
              text: { type: 'object' },
              captions: { type: 'object', description: 'Caption track with segments and optional word timings.' },
              audioAnalysis: { type: 'object', description: 'Audio analysis payload with waveformPeaks for audio-reactive templates.' },
              brand: { type: 'object', description: 'Optional brand kit with colors, fonts, and logo.' },
              style: { type: 'object' },
              durationMs: { type: 'number' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_apply_motion_template',
          description: 'Apply a Remotion-backed motion template instance to the active Video creative scene. Use this for caption reels, audiograms, product promos, and social video presets.',
          parameters: {
            type: 'object',
            required: ['templateId'],
            properties: {
              templateId: { type: 'string', enum: ['caption-reel-v2', 'caption-reel', 'audio-visualizer', 'product-promo'] },
              presetId: { type: 'string' },
              socialFormat: { type: 'string', enum: ['reel', 'short', 'story', 'square', 'feed45', 'youtube'] },
              title: { type: 'string' },
              subtitle: { type: 'string' },
              caption: { type: 'string', description: 'Plain caption/transcript text. Caption Reel will auto-convert this into timed caption segments when captions.segments is omitted.' },
              captionText: { type: 'string', description: 'Alias for plain caption/transcript text.' },
              cta: { type: 'string' },
              text: { type: 'object' },
              captions: { type: 'object', description: 'Caption track with segments and optional word timings.' },
              audioAnalysis: { type: 'object' },
              brand: { type: 'object' },
              style: { type: 'object' },
              durationMs: { type: 'number' },
              startMs: { type: 'number' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'creative_generate_motion_variants',
          description: 'Generate multiple Remotion motion-template variants across presets or styles so the user can choose a direction.',
          parameters: {
            type: 'object',
            required: ['templateId'],
            properties: {
              templateId: { type: 'string', enum: ['caption-reel-v2', 'caption-reel', 'audio-visualizer', 'product-promo'] },
              socialFormat: { type: 'string', enum: ['reel', 'short', 'story', 'square', 'feed45', 'youtube'] },
              count: { type: 'number' },
              title: { type: 'string' },
              subtitle: { type: 'string' },
              caption: { type: 'string', description: 'Plain caption/transcript text. Caption Reel will auto-convert this into timed caption segments when captions.segments is omitted.' },
              captionText: { type: 'string', description: 'Alias for plain caption/transcript text.' },
              cta: { type: 'string' },
              text: { type: 'object' },
              captions: { type: 'object' },
              audioAnalysis: { type: 'object' },
              brand: { type: 'object' },
              style: { type: 'object' },
              durationMs: { type: 'number' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
        name: 'creative_update_element',
        description: 'Update properties on an existing Image/canvas element. Removed from Video mode; patch the active HTML Motion clip or update Remotion/HyperFrames inputs instead.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
            patch: { type: 'object', description: 'Patch object. Dotted keys like meta.content, meta.color, x, y, width, height, rotation, opacity are supported.' },
            props: { type: 'object', description: 'Alias for top-level element patch properties.' },
            style: { type: 'object', description: 'Alias for top-level style patch properties.' },
            meta: { type: 'object', description: 'Nested meta patch; converted to dotted meta.* keys.' },
            text: { type: 'string', description: 'Alias for meta.content.' },
            fontSize: { type: 'number', description: 'Alias for meta.fontSize.' },
            fontWeight: { type: ['number', 'string'], description: 'Alias for meta.fontWeight.' },
            fontFamily: { type: 'string', description: 'Alias for meta.fontFamily.' },
            fill: { type: 'string', description: 'Alias for meta.color.' },
            color: { type: 'string', description: 'Alias for meta.color.' },
            align: { type: 'string', description: 'Alias for meta.textAlign.' },
            lineHeight: { type: 'number', description: 'Alias for meta.lineHeight.' },
            letterSpacing: { type: 'number', description: 'Alias for meta.letterSpacing.' },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
            rotation: { type: 'number' },
            opacity: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
          name: 'creative_delete_element',
        description: 'Delete an element from the active Image/canvas workspace. Removed from Video mode; patch or replace the active HTML Motion/Remotion clip instead.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_apply_animation',
        description: 'Apply a scene-graph animation preset to an Image/canvas element. Removed from Video mode; use HTML/CSS/JS, HyperFrames, or Remotion motion instead.',
        parameters: {
          type: 'object',
          required: ['id', 'preset'],
          properties: {
            id: { type: 'string' },
            preset: { type: 'string', description: 'Preset id, e.g. fade_in, slide_up, fade_slide_up, scale_pop, typewriter, slide_left, bounce_in, zoom_in, spin_in, pulse, shake, soft_blur_in, cascade_in, or enabled custom presets.' },
            startMs: { type: 'number' },
            durationMs: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
          name: 'creative_arrange',
          description:
          'Perform Image/canvas arrangement actions: align, distribute, center, layer ordering, duplicate, lock/unlock, show/hide, or remove elements. Removed from Video mode.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: ['align', 'distribute', 'center', 'layer', 'duplicate', 'lock', 'unlock', 'show', 'hide', 'delete'],
              description: 'Arrangement action to perform.',
            },
            ids: { type: 'array', items: { type: 'string' }, description: 'Element ids. Defaults to current selection when omitted.' },
            axis: { type: 'string', enum: ['x', 'y', 'both'], description: 'Axis for center/distribute.' },
            align: { type: 'string', enum: ['left', 'center', 'right', 'top', 'middle', 'bottom'], description: 'Alignment target.' },
            target: { type: 'string', enum: ['canvas', 'selection'], description: 'Align relative to canvas or selected group bounds.' },
            layer: { type: 'string', enum: ['front', 'back', 'forward', 'backward'], description: 'Layer ordering action.' },
            offsetX: { type: 'number', description: 'Duplicate offset X.' },
            offsetY: { type: 'number', description: 'Duplicate offset Y.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
          name: 'creative_apply_style',
          description:
          'Apply style properties to one or more Image/canvas elements. Removed from Video mode; use CSS variables, HTML patches, or Remotion input/style props instead.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            ids: { type: 'array', items: { type: 'string' }, description: 'Element ids. Defaults to current selection when omitted.' },
            style: { type: 'object', description: 'Top-level element patch, e.g. opacity, rotation, width, height.' },
            meta: { type: 'object', description: 'Nested meta patch, e.g. color, fill, fontSize, fontFamily, radius, stroke, shadow.' },
            fill: { type: 'string', description: 'Alias for meta.color.' },
            color: { type: 'string', description: 'Alias for meta.color.' },
            fontSize: { type: 'number', description: 'Alias for meta.fontSize.' },
            fontWeight: { type: ['number', 'string'], description: 'Alias for meta.fontWeight.' },
            fontFamily: { type: 'string', description: 'Alias for meta.fontFamily.' },
            opacity: { type: 'number', description: 'Top-level opacity.' },
            radius: { type: 'number', description: 'Alias for meta.radius.' },
            shadow: { type: 'string', description: 'Alias for meta.shadow.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
          name: 'creative_fit_asset',
          description:
          'Update an Image/canvas asset element source and fit behavior. Removed from Video mode; replace assets through HTML Motion patching, HyperFrames inputs, or Remotion props.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
            source: { type: 'string', description: 'Asset URL/path/data URL to place in the element.' },
            fit: { type: 'string', enum: ['cover', 'contain', 'fill', 'auto'], description: 'CSS-style object fit/background size behavior.' },
            position: { type: 'string', description: 'Background/object position, e.g. center center, top center.' },
            radius: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
          name: 'creative_apply_template',
          description:
          'Replace or seed the active Image workspace with a polished starter layout/template such as product_ad, social_post, thumbnail, promo_flyer, or quote_card. Removed from Video mode; use HTML Motion, HyperFrames, or Remotion video systems instead.',
        parameters: {
          type: 'object',
          required: ['template'],
          properties: {
            template: { type: 'string', enum: ['social_post', 'thumbnail', 'promo_flyer', 'quote_card', 'product_ad', 'video_promo', 'app_launch', 'event_flyer', 'testimonial', 'carousel', 'tiktok_caption_reel', 'audiogram'] },
            title: { type: 'string' },
            subtitle: { type: 'string' },
            cta: { type: 'string' },
            background: { type: 'string' },
            accent: { type: 'string' },
            replace: { type: 'boolean', description: 'Replace current scene instead of appending. Default true.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_validate_layout',
        description:
          'Run Creative layout validation on the active Image/Video workspace. Checks text overflow, broken line wraps, unsafe margins, accidental overlaps, weak video composition, and export-blocking layout issues before snapshot or export.',
        parameters: emptyObjectSchema(),
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_quality_report',
        description:
          'Run a production-oriented quality report for the active Image/Video workspace. Combines layout validation, timeline/keyframe health, caption timing, audio sync, frame traces, static-frame diffs, asset usage, and export readiness into one ship/no-ship report.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            sampleTimesMs: { type: 'array', items: { type: 'number' }, description: 'Optional video timestamps to trace. Defaults to start/middle/end.' },
            includeHidden: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_list_html_motion_templates',
        description:
          'List built-in and custom HTML motion video templates. Covers vertical 1080x1920 promo/social formats, square/landscape product-demo films, and any templates saved by creative_save_html_motion_template. Each entry returns id, name, description, bestFor, default canvas size/duration/frame rate, required/optional inputs, tweakable parameters/knobs, and source.',
        parameters: emptyObjectSchema(),
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_list_hyperframes_components',
        description:
          'Legacy compatibility: list bundled HyperFrames catalog entries that Prometheus can import into Video Mode as HTML Motion templates or blocks. For agent-created HyperFrames videos, prefer hyperframes_browse_catalog so follow-up edits/lint/QA/export stay on the first-class HyperFrames tool path.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            query: { type: 'string', description: 'Optional text search over id/name/description/tags, such as x post, instagram, shader, chart, logo, transition, or grain.' },
            kind: { type: 'string', description: 'Optional kind filter: template, block, blocks, components, or component.' },
            tag: { type: 'string', description: 'Optional tag filter such as social, overlay, shader, transition, chart, component, or block.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_import_hyperframes_component',
        description:
          'Import one HyperFrames catalog component from the upstream registry into the current Prometheus Creative project. Full HyperFrames compositions become custom HTML Motion templates; snippet components become custom HTML Motion blocks. This fetches source HTML/assets and adapts external runtime dependencies for Prometheus snapshots/export.',
        parameters: {
          type: 'object',
          required: ['componentId'],
          properties: {
            componentId: { type: 'string', description: 'HyperFrames component id, such as x-post, instagram-follow, logo-outro, data-chart, or grain-overlay.' },
            id: { type: 'string', description: 'Alias for componentId.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_sync_hyperframes_catalog',
        description:
          'Legacy compatibility: bulk-import HyperFrames catalog components into the current Creative project so they appear in creative_list_html_motion_templates and creative_list_html_motion_blocks. Prefer hyperframes_browse_catalog plus hyperframes_insert_clip for new agent-created HyperFrames clips.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            ids: {
              oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }],
              description: 'Optional component ids to import. A comma-separated string is accepted.',
            },
            query: { type: 'string', description: 'Optional query to import only matching components.' },
            limit: { type: 'number', description: 'Optional maximum number of matching components to import.' },
            live: { type: 'boolean', description: 'When true, fetch the latest HyperFrames docs index before importing. Defaults false for the bundled snapshot.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_apply_hyperframes_component',
        description:
          'Legacy compatibility: import and immediately apply a HyperFrames catalog component in active Video Mode. For new HyperFrames videos, prefer hyperframes_insert_clip so the clip remains source-backed and can be edited with hyperframes_set_* / hyperframes_apply_patch.',
        parameters: {
          type: 'object',
          required: ['componentId'],
          properties: {
            componentId: { type: 'string', description: 'HyperFrames component id, such as x-post, instagram-follow, logo-outro, data-chart, or grain-overlay.' },
            id: { type: 'string', description: 'Alias for componentId.' },
            inputs: { type: 'object', description: 'Optional template/block input values.' },
            assets: {
              type: 'array',
              description: 'Optional replacement or extra named assets available to the generated HTML as {{asset.id}} placeholders.',
              items: {
                type: 'object',
                required: ['id', 'source'],
                properties: {
                  id: { type: 'string' },
                  source: { type: 'string' },
                  type: { type: 'string', enum: ['image', 'video', 'audio', 'font', 'asset'] },
                  label: { type: 'string' },
                  mimeType: { type: 'string' },
                },
                additionalProperties: false,
              },
            },
            title: { type: 'string' },
            filename: { type: 'string' },
            width: { type: 'number' },
            height: { type: 'number' },
            durationMs: { type: 'number' },
            frameRate: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'hyperframes_browse_catalog',
        description:
          'Browse the HyperFrames catalog as an agent-friendly motion vocabulary. Use this before creating HyperFrames videos so you can choose validated blocks/components instead of hand-writing raw HTML.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            query: { type: 'string', description: 'Search id/name/description/tags, e.g. app showcase, money counter, youtube lower third, shader transition.' },
            kind: { type: 'string', description: 'Optional filter: template, block, blocks, components, component.' },
            tag: { type: 'string', description: 'Optional tag filter such as social, overlay, shader, transition, chart, cta, product.' },
            limit: { type: 'number', description: 'Maximum results to return. Defaults 40.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'hyperframes_insert_clip',
        description:
          'Insert a HyperFrames catalog component or raw HyperFrames HTML as a source-backed editable clip in active Video Mode. Returns the new clip id plus extracted layer/slot/variable counts for follow-up edits.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            catalogId: { type: 'string', description: 'HyperFrames catalog id, e.g. app-showcase, apple-money-count, yt-lower-third. Alias: componentId/id.' },
            componentId: { type: 'string' },
            id: { type: 'string' },
            html: { type: 'string', description: 'Optional raw HyperFrames HTML. Use catalogId when possible.' },
            inputs: { type: 'object', description: 'Template/block input values and variable defaults.' },
            input: { type: 'object', description: 'Alias for inputs.' },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
            startMs: { type: 'number', description: 'Clip start on the Prometheus timeline.' },
            durationMs: { type: 'number', description: 'Clip duration in ms.' },
            zIndex: { type: 'number' },
            advanced: { type: 'boolean', description: 'Force advanced-block mode for opaque GSAP/canvas/WebGL blocks.' },
          },
          additionalProperties: true,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'hyperframes_apply_patch',
        description:
          'Apply typed HyperFrames patch ops to the selected/source-backed HyperFrames clip, then refresh extracted layers/slots/variables in the canvas inspector.',
        parameters: {
          type: 'object',
          required: ['ops'],
          properties: {
            clipId: { type: 'string', description: 'Prometheus canvas HyperFrames clip id. If omitted, uses the selected clip.' },
            elementId: { type: 'string', description: 'Alias for clipId.' },
            ops: {
              type: 'array',
              items: { type: 'object' },
              description: 'HyperFrames patch ops: set-text, set-color, set-font-size, set-position, set-size, set-src, set-timing, set-variable, set-asset, add-animation, update-animation, remove-animation, raw set-attribute/set-style.',
            },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'hyperframes_set_text',
        description: 'Set text on an inner HyperFrames layer by layerId inside a selected/source-backed HyperFrames clip.',
        parameters: {
          type: 'object',
          required: ['layerId', 'text'],
          properties: {
            clipId: { type: 'string' },
            elementId: { type: 'string', description: 'Alias for clipId.' },
            layerId: { type: 'string', description: 'Inner HyperFrames element id from extraction/layers.' },
            text: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'hyperframes_set_color',
        description: 'Set text/color styling on an inner HyperFrames layer.',
        parameters: {
          type: 'object',
          required: ['layerId', 'color'],
          properties: {
            clipId: { type: 'string' },
            elementId: { type: 'string', description: 'Alias for clipId.' },
            layerId: { type: 'string' },
            color: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'hyperframes_set_timing',
        description: 'Set start/duration/z-index timing for an inner HyperFrames layer.',
        parameters: {
          type: 'object',
          required: ['layerId'],
          properties: {
            clipId: { type: 'string' },
            elementId: { type: 'string', description: 'Alias for clipId.' },
            layerId: { type: 'string' },
            startMs: { type: 'number' },
            durationMs: { type: 'number' },
            zIndex: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'hyperframes_set_variable',
        description: 'Set a HyperFrames composition variable or data-prom-slot-variable binding on the selected/source-backed clip.',
        parameters: {
          type: 'object',
          required: ['name', 'value'],
          properties: {
            clipId: { type: 'string' },
            elementId: { type: 'string', description: 'Alias for clipId.' },
            name: { type: 'string' },
            value: {},
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'hyperframes_set_asset',
        description: 'Swap an inner media layer to a Prometheus asset placeholder such as {{asset.logo}}.',
        parameters: {
          type: 'object',
          required: ['layerId', 'assetId'],
          properties: {
            clipId: { type: 'string' },
            elementId: { type: 'string', description: 'Alias for clipId.' },
            layerId: { type: 'string' },
            assetId: { type: 'string', description: 'Asset placeholder id, without {{asset. }} wrapper.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'hyperframes_add_animation',
        description: 'Add a GSAP animation definition to the selected/source-backed HyperFrames clip.',
        parameters: {
          type: 'object',
          required: ['animation'],
          properties: {
            clipId: { type: 'string' },
            elementId: { type: 'string', description: 'Alias for clipId.' },
            animation: { type: 'object' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'hyperframes_lint',
        description: 'Lint supplied HyperFrames HTML or the selected/source-backed HyperFrames clip with @hyperframes/core.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            clipId: { type: 'string' },
            elementId: { type: 'string', description: 'Alias for clipId.' },
            html: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'hyperframes_qa',
        description:
          'Run Playwright snapshot QA on supplied HyperFrames HTML or the selected/source-backed clip. Captures start/mid/end frames, reports network/console failures, and uses the Prometheus seek bridge.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            clipId: { type: 'string' },
            elementId: { type: 'string', description: 'Alias for clipId.' },
            html: { type: 'string' },
            width: { type: 'number' },
            height: { type: 'number' },
            durationMs: { type: 'number' },
            samplePoints: { type: 'array', items: { type: 'number' } },
            timeoutMs: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'hyperframes_materialize',
        description: 'Materialize supplied or selected HyperFrames HTML into an on-disk HTML Motion clip descriptor that the existing renderer can consume.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            clipId: { type: 'string' },
            elementId: { type: 'string', description: 'Alias for clipId.' },
            html: { type: 'string' },
            compositionId: { type: 'string' },
            startMs: { type: 'number' },
            endMs: { type: 'number' },
            durationMs: { type: 'number' },
            trimStartMs: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'hyperframes_export',
        description: 'Export the active Video workspace containing HyperFrames clips through the existing Prometheus export pipeline. Defaults to MP4.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            format: { type: 'string', enum: ['mp4', 'webm', 'gif'], description: 'Defaults mp4.' },
            workspaceOnly: { type: 'boolean', description: 'Save to workspace creative exports. Defaults true.' },
            download: { type: 'boolean', description: 'Also trigger browser download. Defaults false.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_list_library_packs',
        description:
          'List Creative element/motion library packs available to the current project, including built-in packs and custom packs Prometheus has created. Returns enabled state, source, category, includes, and optional element/preset payloads.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            includeElements: { type: 'boolean', description: 'Include full custom element and animation preset payloads. Defaults false for a compact catalog.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_create_library_pack',
        description:
          'Create a reusable custom Creative library pack for Prometheus with element presets and/or animation presets, then optionally enable it for the current project. Use this when a brand/style/system needs reusable blocks in the Creative workspace.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            id: { type: 'string', description: 'Stable custom pack id. Must not conflict with built-in pack ids.' },
            label: { type: 'string' },
            category: { type: 'string', enum: ['core', 'icons', 'motion', 'components', 'shapes'] },
            description: { type: 'string' },
            includes: { type: 'array', items: { type: 'string' } },
            enabled: { type: 'boolean', description: 'Enable the pack immediately. Defaults true.' },
            defaultEnabled: { type: 'boolean' },
            sourceUrl: { type: 'string' },
            elements: {
              type: 'object',
              description: 'Element presets grouped by section: text, shapes, icons, images, components. Each entry should include kind/id, label, type, and optional meta/defaultWidth/defaultHeight.',
              additionalProperties: { type: 'array', items: { type: 'object' } },
            },
            animationPresets: {
              type: 'array',
              description: 'Animation presets with id/label, targets, defaultDurationMs, from/to transform states, holdMs, ease, and optional effects.',
              items: { type: 'object' },
            },
            pack: { type: 'object', description: 'Optional full manifest object. If supplied, it is used as the pack body.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_toggle_library_pack',
        description: 'Enable or disable a Creative library pack for the current project, including built-in or custom packs.',
        parameters: {
          type: 'object',
          required: ['libraryId'],
          properties: {
            libraryId: { type: 'string', description: 'Pack id from creative_list_library_packs.' },
            enabled: { type: 'boolean', description: 'Defaults true. Set false to disable.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_apply_html_motion_template',
        description:
          'Render a built-in or custom HTML motion video template into the active Video workspace. Generates a polished self-contained HTML/CSS animation from the chosen templateId and inputs, then installs it the same way as creative_create_html_motion_clip. Use this for quick promo/ad/social video clips instead of inventing raw HTML. After applying, run creative_render_html_motion_snapshot for frame QA before exporting.',
        parameters: {
          type: 'object',
          required: ['templateId'],
          properties: {
            templateId: {
              type: 'string',
              description: 'Template identifier from creative_list_html_motion_templates.',
            },
            inputs: {
              type: 'object',
              description: 'Template input values keyed by input id (e.g. brand, headline, cta, accent). Required input ids are listed by creative_list_html_motion_templates.',
              additionalProperties: { type: 'string' },
            },
            input: {
              type: 'object',
              description: 'Alias for inputs.',
              additionalProperties: { type: 'string' },
            },
            assets: {
              type: 'array',
              description: 'Optional named image/video/audio/font assets available to the generated HTML as {{asset.id}} placeholders.',
              items: {
                type: 'object',
                required: ['id', 'source'],
                properties: {
                  id: { type: 'string' },
                  source: { type: 'string' },
                  type: { type: 'string', enum: ['image', 'video', 'audio', 'font', 'asset'] },
                  label: { type: 'string' },
                  mimeType: { type: 'string' },
                },
                additionalProperties: false,
              },
            },
            title: { type: 'string', description: 'Optional clip title.' },
            eyebrow: { type: 'string', description: 'Optional common template input, passed through when the template supports it.' },
            subtitle: { type: 'string', description: 'Optional common template input, passed through when the template supports it.' },
            cta: { type: 'string', description: 'Optional common template input, passed through when the template supports it.' },
            accent: { type: 'string', description: 'Optional common template input, passed through when the template supports it.' },
            assetId: { type: 'string', description: 'Optional common template input for named {{asset.id}} placeholders.' },
            durationSec: { type: 'string', description: 'Optional template duration in seconds for templates that use an in-HTML duration input.' },
            filename: { type: 'string', description: 'Optional .html filename for workspace storage.' },
            width: { type: 'number', description: 'Override template default width.' },
            height: { type: 'number', description: 'Override template default height.' },
            durationMs: { type: 'number', description: 'Override template default duration.' },
            frameRate: { type: 'number', description: 'Override template default frame rate.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_create_html_motion_clip',
        description:
          'Create or replace the active Video workspace with a self-contained HTML/CSS motion clip. Use for polished quick promo videos, ads, social clips, animated typography, product cards, and richer CSS/JS-based motion when primitive canvas layers would look basic. HyperFrames-style HTML timing attributes such as data-start, data-duration, data-end, data-trim-start, and data-offset are honored during frame snapshots; JS clips can also listen for the prometheus-html-motion-seek event or read window.__PROMETHEUS_HTML_MOTION_TIME_SECONDS__. After creating, run creative_render_html_motion_snapshot or creative_render_snapshot before exporting.',
        parameters: {
          type: 'object',
          required: ['html'],
          properties: {
            title: { type: 'string' },
            html: { type: 'string', description: 'Complete self-contained HTML document with inline CSS/JS only. No external network dependencies. HyperFrames-compatible data-start/data-duration/data-end timing attributes are supported for frame QA.' },
            filename: { type: 'string', description: 'Optional .html filename for workspace storage.' },
            assets: {
              type: 'array',
              description: 'Named image/video/audio/font assets available to the HTML as {{asset.id}} placeholders. Sources may be workspace paths, data URLs, or HTTP(S) URLs.',
              items: {
                type: 'object',
                required: ['id', 'source'],
                properties: {
                  id: { type: 'string', description: 'Kebab/snake-safe asset id, e.g. logo, hero, demo-video.' },
                  source: { type: 'string', description: 'Workspace path, data URL, or HTTP(S) URL.' },
                  type: { type: 'string', enum: ['image', 'video', 'audio', 'font', 'asset'] },
                  label: { type: 'string' },
                  mimeType: { type: 'string' },
                },
                additionalProperties: false,
              },
            },
            width: { type: 'number', description: 'Canvas width, normally 1080 for vertical social video.' },
            height: { type: 'number', description: 'Canvas height, normally 1920 for vertical social video.' },
            durationMs: { type: 'number' },
            frameRate: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_save_html_motion_template',
        description:
          'Save a reusable custom HTML motion template into the current Creative project. Provide html directly, or omit html in Video mode to capture the active HTML motion clip.',
        parameters: {
          type: 'object',
          required: ['id', 'name'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            title: { type: 'string', description: 'Alias for name when saving from an active clip.' },
            description: { type: 'string' },
            bestFor: { type: 'string' },
            html: { type: 'string', description: 'Self-contained HTML document. If omitted, the active Video HTML motion clip is read.' },
            useActiveClip: { type: 'boolean', description: 'Defaults true when html is omitted.' },
            defaultInputs: { type: 'object', additionalProperties: { type: 'string' } },
            requiredInputs: { type: 'array', items: { type: 'object' } },
            optionalInputs: { type: 'array', items: { type: 'object' } },
            parameters: { type: 'array', items: { type: 'object' } },
            width: { type: 'number' },
            height: { type: 'number' },
            durationMs: { type: 'number' },
            frameRate: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_save_html_motion_block',
        description:
          'Save a reusable custom HTML motion block/snippet into the current Creative project. Blocks render into HTML/CSS/JS snippets via creative_render_html_motion_block and are useful for Prometheus-authored building blocks.',
        parameters: {
          type: 'object',
          required: ['id', 'name'],
          properties: {
            id: { type: 'string' },
            packId: { type: 'string', description: 'Logical block pack id. Defaults prometheus-custom.' },
            name: { type: 'string' },
            description: { type: 'string' },
            category: { type: 'string', description: 'captions, typography, layout, product, charts, media, transitions, cta, utility, experimental, or custom category.' },
            tags: { type: 'array', items: { type: 'string' } },
            bestFor: { type: 'string' },
            slots: { type: 'array', items: { type: 'object' } },
            requiredStageFeatures: { type: 'array', items: { type: 'string' } },
            outputContract: { type: 'object' },
            html: { type: 'string' },
            css: { type: 'string' },
            js: { type: 'string' },
            block: { type: 'object', description: 'Optional full block manifest object. If supplied, it is used as the block body.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_promote_scene_to_template',
        description:
          'Promote the current active Image/Video scene into a reusable custom scene template saved in the Creative project. Optionally also save the active Video HTML motion clip as an HTML motion template.',
        parameters: {
          type: 'object',
          required: ['id', 'name'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            category: { type: 'string' },
            bestFor: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            slots: { type: 'array', items: { type: 'object' } },
            saveHtmlTemplate: { type: 'boolean', description: 'In Video mode, also save the active HTML motion clip as a custom HTML motion template.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_lint_html_motion_clip',
        description:
          'Lint the active or supplied HTML motion clip against the Prometheus/HyperFrames-compatible composition contract. Checks stage metadata, timing attributes, dimensions, duration, media timing, external dependencies, tracks, roles, asset placeholders, AND a pretext-driven text-fit pass that flags captions/titles likely to overflow before snapshot/export.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            html: { type: 'string', description: 'Optional raw HTML to lint directly. If omitted, lints the active HTML motion clip through the editor.' },
            manifest: { type: 'object', description: 'Optional manifest metadata when linting raw HTML.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_measure_text',
        description:
          'Pretext-driven deterministic text-fit check. Given copy, font, and a target box, returns measured height, line count, overflow flags, and a suggested font size when the text would overflow. Use this before placing a hero title or caption to avoid wasted snapshot/export cycles.',
        parameters: {
          type: 'object',
          required: ['text', 'width'],
          properties: {
            text: { type: 'string', description: 'Copy to measure. Newlines are treated as forced breaks.' },
            width: { type: 'number', description: 'Available text-box width in px.' },
            maxHeight: { type: 'number', description: 'Optional available text-box height in px. Required to flag height overflow and to receive a suggestedFontSize.' },
            fontSize: { type: 'number', description: 'Font size in px. Defaults to 24.' },
            fontFamily: { type: 'string', description: 'Font family hint (Inter, Manrope, Bebas Neue, Playfair Display, mono, etc.). Tunes the average glyph width.' },
            fontWeight: { type: 'number', description: 'Numeric weight (100-900). Defaults to 400.' },
            fontStyle: { type: 'string', description: 'normal | italic | oblique.' },
            lineHeight: { type: 'number', description: 'Unitless multiplier (e.g. 1.2) or px (>4 treated as px). Defaults to 1.2.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_text_fit_report',
        description:
          'Run the pretext-driven text-fit pass over an HTML motion clip and return per-element overflow findings (selector, tag, classes, text, fontSize, measured/available height, suggested font size). Use to debug overflow warnings surfaced by creative_lint_html_motion_clip.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            html: { type: 'string', description: 'Raw HTML to scan. If omitted, uses the active HTML motion clip.' },
            stageWidth: { type: 'number' },
            stageHeight: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_list_html_motion_blocks',
        description:
          'List backend HTML motion block definitions and contracts for Prometheus Video Mode. These blocks are composable HTML/CSS/JS snippets for captions, lower thirds, product cards, notification stacks, icon bursts, offer cards, transitions, timelines, charts, CTA cards, and seekable canvas hooks.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            category: { type: 'string', description: 'Optional category filter such as captions, layout, charts, transitions, cta, utility, or 3d.' },
            query: { type: 'string', description: 'Optional text search over id/name/tags/bestFor.' },
            packId: { type: 'string', description: 'Optional pack filter. Core backend pack is prometheus-core.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_render_html_motion_block',
        description:
          'Render a backend HTML motion block to HTML/CSS/JS snippets. This does not modify the active clip by itself; use creative_patch_html_motion_clip to insert the returned snippets into a stable region of the current HTML motion clip.',
        parameters: {
          type: 'object',
          required: ['blockId'],
          properties: {
            blockId: {
              type: 'string',
              description: 'Block id from creative_list_html_motion_blocks. Built-in and custom block ids are accepted.',
            },
            inputs: { type: 'object', description: 'Block slot values such as text/start/duration/accent/title/subtitle/id/assets depending on the block definition.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_read_html_motion_clip',
        description:
          'Read the active HTML motion clip before editing it. Returns the current HTML source, manifest, assets, selector/region/CSS-variable outline, and revision list so edits can be made surgically instead of regenerating the whole clip.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            includeHtml: { type: 'boolean', description: 'Include full HTML source. Defaults to true. Set false for a compact outline-only read.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_patch_html_motion_clip',
        description:
          'Patch the active HTML motion clip in place using deterministic edit operations. Creates a revision checkpoint before changing the source. Use this for copy, CSS variable, region, marker, insertion, and asset edits instead of recreating the clip.',
        parameters: {
          type: 'object',
          required: ['ops'],
          properties: {
            reason: { type: 'string', description: 'Short reason for the checkpoint, e.g. "make CTA punchier".' },
            includeHtml: { type: 'boolean', description: 'Return full updated HTML source in the result. Defaults to false.' },
            ops: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                required: ['op'],
                properties: {
                  op: {
                    type: 'string',
                    enum: ['replace_text', 'replace_between', 'insert_before', 'insert_after', 'set_css_var', 'replace_css_var', 'replace_asset', 'set_manifest'],
                  },
                  find: { type: 'string', description: 'Literal text to replace for replace_text.' },
                  replace: { type: 'string', description: 'Replacement text for replace_text.' },
                  occurrence: { oneOf: [{ type: 'number' }, { type: 'string', enum: ['all'] }], description: 'Which literal occurrence to replace; use "all" for every occurrence.' },
                  start: { type: 'string', description: 'Start marker for replace_between.' },
                  end: { type: 'string', description: 'End marker for replace_between.' },
                  replacement: { type: 'string', description: 'Replacement content for replace_between.' },
                  marker: { type: 'string', description: 'Marker for insert_before/insert_after.' },
                  content: { type: 'string', description: 'HTML/CSS/JS content to insert.' },
                  name: { type: 'string', description: 'CSS variable name for set_css_var/replace_css_var, e.g. --accent or accent.' },
                  value: { description: 'CSS variable value or manifest value.' },
                  id: { type: 'string', description: 'Asset id for replace_asset.' },
                  source: { type: 'string', description: 'Workspace path, data URL, or HTTP(S) URL for replace_asset.' },
                  type: { type: 'string', enum: ['image', 'video', 'audio', 'font', 'asset'] },
                  label: { type: 'string' },
                  mimeType: { type: 'string' },
                  key: { type: 'string', description: 'Manifest key for set_manifest.' },
                  required: { type: 'boolean', description: 'Set false to make a missing marker/find a non-fatal no-op.' },
                },
                additionalProperties: true,
              },
            },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_restore_html_motion_revision',
        description:
          'Restore the active HTML motion clip to a saved revision created before a patch. Use when a patch made the design worse or the user asks to roll back.',
        parameters: {
          type: 'object',
          required: ['revisionId'],
          properties: {
            revisionId: { type: 'string', description: 'Revision id returned by creative_read_html_motion_clip or creative_patch_html_motion_clip.' },
            includeHtml: { type: 'boolean', description: 'Return full restored HTML source. Defaults to false.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_render_html_motion_snapshot',
        description:
          'Render actual frames from the active HTML motion clip using the server browser renderer and inject them for visual QA. Use start/mid/end samples before export to catch bad wraps, dead frames, or weak composition.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            atMs: { type: 'number' },
            sampleTimesMs: { type: 'array', items: { type: 'number' } },
            includeDataUrl: { type: 'boolean', description: 'Deprecated for AI calls. Frames are returned internally for direct review.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_export_html_motion_clip',
        description:
          'Export the active HTML/CSS motion clip to an MP4 in the workspace creative exports directory using server-side browser frame capture plus FFmpeg. Use after frame QA passes.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            format: { type: 'string', enum: ['mp4'], description: 'Currently mp4 only.' },
            filename: { type: 'string', description: 'Optional export filename.' },
            frameRate: { type: 'number', enum: [24, 30, 60], description: 'Output frame rate. Defaults to the clip manifest frameRate or 60.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_timeline',
        description:
          'Perform timeline-native Video Mode actions: set duration/playhead, create captions, sequence elements, trim element visibility, or stagger entrance animations.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['set_duration', 'set_playhead', 'caption', 'sequence', 'trim_visibility', 'stagger_animations'] },
            ids: { type: 'array', items: { type: 'string' }, description: 'Target element ids. Defaults to selection where applicable.' },
            durationMs: { type: 'number' },
            atMs: { type: 'number' },
            startMs: { type: 'number' },
            clipDurationMs: { type: 'number' },
            gapMs: { type: 'number' },
            text: { type: 'string', description: 'Caption text.' },
            preset: { type: 'string', description: 'Animation preset for stagger_animations.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
        type: 'function',
        function: {
        name: 'creative_render_snapshot',
          description: 'Render actual screenshot/frame image(s) from the active creative workspace and inject those frames directly into the next vision-capable model step. Use sampleEveryFrame or frameStepMs for dense video review batches.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            atMs: { type: 'number', description: 'Video playhead time to render. Ignored for static image mode.' },
            sampleTimesMs: { type: 'array', items: { type: 'number' }, description: 'Video frame times to sample in one review call. Useful for checking the beginning, middle, and end before exporting.' },
              sampleEveryFrame: { type: 'boolean', description: 'Video mode only. Render frames at the scene frame-rate from startMs to endMs, up to maxFrames, so the agent can inspect dense playback directly.' },
              frameStepMs: { type: 'number', description: 'Video mode only. Render a dense sequence from startMs to endMs at this millisecond step.' },
              startMs: { type: 'number', description: 'Start time for sampleEveryFrame/frameStepMs review.' },
              endMs: { type: 'number', description: 'End time for sampleEveryFrame/frameStepMs review.' },
              maxFrames: { type: 'number', description: 'Maximum frames to render/inject for this batch. Hard-capped by the browser runtime.' },
              includeDataUrl: { type: 'boolean', description: 'Deprecated for AI calls. Visual frames are always returned internally for direct self-review.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_export',
        description: 'Export the active creative workspace to the workspace creative exports directory by default. Image mode supports png, jpeg, pdf, svg. Video mode supports webm, mp4, gif plus image formats for frames; video exports default to at least 60fps.',
        parameters: {
          type: 'object',
          required: ['format'],
          properties: {
            format: { type: 'string', enum: ['png', 'jpeg', 'jpg', 'pdf', 'svg', 'webm', 'mp4', 'gif'] },
            download: { type: 'boolean', description: 'If true, also trigger a browser download. Defaults false for AI/tool exports so files are saved to workspace only.' },
            workspaceOnly: { type: 'boolean', description: 'If true, save only to the workspace creative exports directory. Defaults true.' },
            force: { type: 'boolean', description: 'Legacy compatibility flag. Video export no longer runs a separate pre-export critic gate.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_save_scene',
        description: 'Save the current Image/Video scene/project snapshot into creative asset storage.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            filename: { type: 'string', description: 'Optional scene filename, e.g. promo-poster-scene.json.' },
          },
          additionalProperties: false,
        },
      },
    },
    // ── Composition (multi-clip timeline) ─────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'creative_composition_get',
        description: 'Return the active multi-clip composition for the current Video session, including tracks, clips, audioTracks, captions, and a summary. Use this before mutating HTML Motion or Remotion clips on the master timeline.',
        parameters: emptyObjectSchema(),
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_composition_add_track',
        description: 'Add a new track lane (video, audio, or caption) to the active composition.',
        parameters: {
          type: 'object',
          required: ['kind'],
          properties: {
            kind: { type: 'string', enum: ['video', 'audio', 'caption'] },
            label: { type: 'string', description: 'Optional label, e.g. V2 or Music.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_composition_add_clip',
        description: 'Place an HTML Motion or Remotion clip on a track at a specific master-timeline position. Scene-graph clips are not part of Video mode.',
        parameters: {
          type: 'object',
          required: ['lane', 'source'],
          properties: {
            trackId: { type: 'string' },
            lane: { type: 'string', enum: ['html-motion', 'remotion'] },
            source: { type: 'object', description: 'Source descriptor matching the lane: { kind:"html-motion", clipPath } or { kind:"remotion", templateId, presetId?, input }.' },
            atMs: { type: 'number', description: 'Master-timeline insertion point in ms.' },
            durationMs: { type: 'number', description: 'Clip duration in ms when outMs is not provided.' },
            inMs: { type: 'number' },
            outMs: { type: 'number' },
            trimStartMs: { type: 'number' },
            trimEndMs: { type: 'number' },
            label: { type: 'string' },
            ripple: { type: 'boolean', description: 'When true, push subsequent clips on the same track later by this clip\'s duration.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_composition_move_clip',
        description: 'Move a clip to a new master-timeline position and/or to a different track. Provide atMs for absolute position or deltaMs for relative shift.',
        parameters: {
          type: 'object',
          required: ['clipId'],
          properties: {
            clipId: { type: 'string' },
            trackId: { type: 'string' },
            atMs: { type: 'number' },
            deltaMs: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_composition_trim_clip',
        description: 'Trim a clip\'s head or tail to a master-timeline position. trimStartMs/trimEndMs (against the source) are updated automatically.',
        parameters: {
          type: 'object',
          required: ['clipId', 'edge', 'toMs'],
          properties: {
            clipId: { type: 'string' },
            edge: { type: 'string', enum: ['head', 'tail'] },
            toMs: { type: 'number', description: 'New master-timeline position for the chosen edge.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_composition_split_at',
        description: 'Split a clip at a master-timeline position, creating two adjacent clips that share the same source.',
        parameters: {
          type: 'object',
          required: ['clipId', 'atMs'],
          properties: {
            clipId: { type: 'string' },
            atMs: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_composition_delete_clip',
        description: 'Remove a clip from the composition. Pass ripple=true to close the gap on the same track.',
        parameters: {
          type: 'object',
          required: ['clipId'],
          properties: {
            clipId: { type: 'string' },
            ripple: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_composition_set_transition',
        description: 'Set or clear the in/out transition on a clip (cut, fade, crossfade, wipe-left, wipe-right, dip-to-color).',
        parameters: {
          type: 'object',
          required: ['clipId', 'edge'],
          properties: {
            clipId: { type: 'string' },
            edge: { type: 'string', enum: ['in', 'out'] },
            transition: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['cut', 'fade', 'crossfade', 'wipe-left', 'wipe-right', 'dip-to-color'] },
                durationMs: { type: 'number' },
                color: { type: 'string' },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_composition_select_clip',
        description: 'Select an HTML Motion or Remotion clip on the timeline. Pass null to deselect.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            clipId: { type: ['string', 'null'] },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_composition_lint',
        description: 'Run structural lint on the active composition. Reports overlaps, gaps, missing video track, and zero-duration clips.',
        parameters: emptyObjectSchema(),
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_composition_render',
        description: 'Render the active multi-clip composition to a single MP4 (or webm) using the server-side ffmpeg pipeline. Each clip is rendered to PNG frames per its lane, encoded, concatenated, and audio tracks are mixed and muxed. Returns the workspace path of the output file.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            format: { type: 'string', enum: ['mp4', 'webm'], description: 'Output container/codec. Defaults to mp4.' },
            filename: { type: 'string', description: 'Optional output filename. Defaults to composition-{timestamp}.{ext}.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'creative_composition_save',
        description: 'Persist the active composition as a JSON file under the creative scenes directory.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            filename: { type: 'string', description: 'Optional filename, defaults to {mode}-composition.json.' },
          },
          additionalProperties: false,
        },
      },
    },
  ];

  return filterPublicBuildToolDefs(tools);
}
