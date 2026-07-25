// /taskdrop-b is the B variant of /taskdrop and shares its card. It needs its own file
// rather than a link to /taskdrop's: Next serves each metadata image route at a path it
// generates itself, so a route without a colocated file falls back to the root card and a
// hardcoded path to a sibling's card resolves to a 404.
export { alt, contentType, default, size } from '../taskdrop/opengraph-image';
