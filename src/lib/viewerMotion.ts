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
