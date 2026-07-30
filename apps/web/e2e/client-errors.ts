export function isWebKitRscPrefetchAccessControlError(projectName: string, text: string) {
  return (
    projectName.includes('webkit') &&
    text.includes('_rsc=') &&
    text.includes('due to access control checks.')
  );
}

// WebKit's native <video controls> chrome logs a console error of its own accord when
// it cannot load the icon for one of its built-in placard buttons (invalid,
// picture-in-picture, AirPlay) -- this is WebKit's native media-control UI failing to
// load its own iconography, not an application error, and it does not affect the
// control's function. It only started surfacing in this suite because the submission
// gallery now windows several adjacent <video controls> panes at once (see
// gallerySlots in submission-gallery.tsx), so more of them exist on screen
// simultaneously. Scoped tightly to that one message shape so it can never mask a
// real application error.
export function isWebKitMediaControlIconLoadError(projectName: string, text: string) {
  return (
    projectName.includes('webkit') &&
    text.includes('Button failed to load') &&
    /iconName = (invalid|pip|airplay)-placard/.test(text)
  );
}
