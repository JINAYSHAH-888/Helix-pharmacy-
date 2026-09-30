// 017 tamper plate = the library velocity distortion, unmodified. uVelocity is
// driven by a time-based glitch envelope instead of scroll velocity, so the
// broken hash keeps tearing after scrolling stops.
#include "../lib/distort/velocityImage.frag"
