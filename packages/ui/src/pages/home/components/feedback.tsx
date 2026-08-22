import {
  AnimatePresence, AppToast, Check, motion, motionEase, reducedMotionTransition,
  useReducedMotion
} from "../shared/index";
export function LightToast({ toast }: { toast?: AppToast }) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {toast ? (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="md-type-label-large pointer-events-none fixed left-1/2 top-5 z-[10000] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-[var(--md-sys-shape-corner-small)] bg-[var(--md-sys-color-inverse-surface)] px-4 py-2.5 text-[var(--md-sys-color-inverse-on-surface)] shadow-[var(--md-elevation-level3)]"
          exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
          initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
          key={toast.id}
          role="status"
          transition={shouldReduceMotion ? reducedMotionTransition : { duration: 0.16, ease: motionEase }}
        >
          <Check className="h-3.5 w-3.5 shrink-0 text-[var(--md-sys-color-inverse-primary)]" />
          <span className="truncate">{toast.message}</span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
