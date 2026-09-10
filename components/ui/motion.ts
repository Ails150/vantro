// Shared motion presets. Everything sits in the 150-250ms ease-out band the
// design brief specifies -- no spring, no bounce, no overshoot. Import these
// rather than hand-rolling transitions so timing stays uniform across tabs.
import type { Transition, Variants } from "framer-motion"

export const EASE_OUT = [0.16, 1, 0.3, 1] as const

export const transition: Transition = { duration: 0.2, ease: EASE_OUT }
export const transitionFast: Transition = { duration: 0.15, ease: EASE_OUT }
export const transitionSlow: Transition = { duration: 0.25, ease: EASE_OUT }

/** Page/tab level. A short rise, not a slide. */
export const pageVariants: Variants = {
  hidden: { opacity: 0, y: 4 },
  visible: { opacity: 1, y: 0, transition },
  exit: { opacity: 0, transition: transitionFast },
}

/** Parent of a list. Staggers children without animating itself. */
export const listVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.02, delayChildren: 0.02 } },
}

/** One row/card inside a staggered list. */
export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 4 },
  visible: { opacity: 1, y: 0, transition: transitionFast },
}
