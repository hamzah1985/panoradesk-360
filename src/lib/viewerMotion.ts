export type ViewerMotionOptions = {
  mousewheel: boolean;
  mousemove: boolean;
  moveInertia: boolean;
  moveSpeed: number;
  minFov: number;
  maxFov: number;
  zoomSpeed: number;
};

export type ViewerInertiaTuning = {
  alphaDragging: number;
  alphaIdle: number;
  /** Release "fling": time constant (ms) over which the release velocity decays. 0 disables it. */
  flingTauMs: number;
  /** Release "fling": speed cap in radians per second. */
  flingMaxSpeed: number;
};

// Single source of truth for orbit/motion behavior across editor + preview.
export const SHARED_VIEWER_MOTION: ViewerMotionOptions = {
  mousewheel: true,
  mousemove: false,  // our position-lerp system owns mouse drag
  moveInertia: false,
  moveSpeed: 0.92,
  minFov: 42,
  maxFov: 90,
  zoomSpeed: 0.88,
};

// Position-lerp inertia (Marzipano-style): camera chases a target position.
// alphaDragging: fraction of gap closed per frame while dragging (spring feel).
// alphaIdle: fraction of gap closed per frame after release (glide-to-stop).
export const SHARED_VIEWER_INERTIA: ViewerInertiaTuning = {
  alphaDragging: 0.14,
  alphaIdle: 0.08,
  // After letting go the view keeps coasting in the drag direction with the
  // release velocity, decaying exponentially (like Street View / Matterport).
  // Total coast distance is about releaseSpeed * flingTauMs.
  flingTauMs: 150,
  flingMaxSpeed: 6,
};

export type ViewerTransitionOptions = {
  duration: number;
  effect: 'fade' | 'black' | 'white';
};

// Single source of truth for scene transition behavior across editor + preview.
export const SHARED_VIEWER_TRANSITION: ViewerTransitionOptions = {
  duration: 900,
  effect: 'fade',
};
