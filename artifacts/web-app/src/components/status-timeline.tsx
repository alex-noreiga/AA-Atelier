import type { ReactNode } from "react";

/** State of a single timeline node relative to the order's current position. */
export interface TimelineNodeState {
  isCompleted: boolean;
  isActive: boolean;
  isFuture: boolean;
}

/**
 * The vertical progress timeline shared by the custom-order and shop-order
 * tracking views: a threaded list of stages/statuses with a completed / active /
 * future treatment per node and a "Completed" caption on passed nodes. Callers
 * pass the ordered labels plus the index of the current one; `renderExtra` injects
 * any per-node content that sits under the heading (e.g. the custom view's target
 * date + active-stage description). `testIdPrefix` distinguishes the two views'
 * rows (`row-stage` vs `row-status`).
 */
export function StatusTimeline({
  items,
  currentIndex,
  testIdPrefix,
  renderExtra,
}: {
  items: string[];
  currentIndex: number;
  testIdPrefix: string;
  renderExtra?: (
    item: string,
    index: number,
    state: TimelineNodeState,
  ) => ReactNode;
}) {
  return (
    <div className="relative pl-6 md:pl-8 space-y-12">
      {/* Vertical Thread Line */}
      <div className="absolute left-[11px] md:left-[15px] top-2 bottom-2 w-[1px] bg-border z-0"></div>

      {items.map((item, index) => {
        const isCompleted = index < currentIndex;
        const isActive = index === currentIndex;
        const isFuture = index > currentIndex;

        return (
          <div
            key={item}
            className="relative z-10 flex items-start group"
            data-testid={`${testIdPrefix}-${index}`}
          >
            {/* Indicator Node */}
            <div className="absolute -left-6 md:-left-8 flex items-center justify-center w-6 h-6 bg-background">
              <div
                className={`
                  w-2.5 h-2.5 rounded-full transition-all duration-700
                  ${isActive ? "bg-primary shadow-[0_0_12px_var(--color-primary)] scale-125" : ""}
                  ${isCompleted ? "bg-primary/50" : ""}
                  ${isFuture ? "bg-border" : ""}
                `}
              />
            </div>

            {/* Node Content */}
            <div
              className={`
                flex-1 pl-6 transition-all duration-500
                ${isActive ? "opacity-100 translate-x-2" : ""}
                ${isCompleted ? "opacity-60" : ""}
                ${isFuture ? "opacity-30" : ""}
              `}
            >
              <h3
                className={`
                  font-serif text-2xl mb-1
                  ${isActive ? "text-primary" : "text-foreground"}
                `}
              >
                {item}
              </h3>
              {renderExtra?.(item, index, { isCompleted, isActive, isFuture })}
              {isCompleted && (
                <p className="text-muted-foreground/50 font-light text-xs uppercase tracking-widest">
                  Completed
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
