# Mobile Hub, More, Proposals, Settings, and Creative Status

## Hub and More

`#mobile/hub` is the mobile operational hub. `#mobile/more` is the navigation/summary landing and routes its Hub selection to the Hub page. More also hosts mobile Audit and Memory views; Memory mounts the graph client in the mobile wrapper.

## Proposals

`#mobile/proposals[/<id>]` lists proposals with status filters—pending, in-progress, approved, denied, executed and all—plus refresh. Detail/review shows fast approval cards, plan/evidence/technical scope where supplied, and approve/deny controls. It is a governed review surface, not an automatic execution queue.

## Settings

`#mobile/settings[/<tab>]` renders mobile Chat behind the shared desktop Settings modal, reparents that modal outside the hidden desktop shell, and opens the requested settings tab full-screen. There is one settings implementation and the paired token is used by its API calls.

## Creative implementation status

The bundle includes a focused `renderCreativePage` with image/video mode, provider/aspect/template/preset choice, uploads, layer extraction, generation and gallery output. The current router intentionally maps `creative` to Hub and has no creative render case, so it is implemented but not a shipped standalone mobile route.
