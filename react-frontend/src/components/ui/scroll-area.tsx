import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Lightweight native scroll area replacement.
 * Radix's ScrollArea can cause ref/state cycles in some versions/environments.
 * This component uses a native scroll container (overflow: auto) which
 * is simpler and avoids Radix internals that were causing a "Maximum update depth" error.
 */
function ScrollArea({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="scroll-area" className={cn("relative overflow-auto", className)} {...props}>
      <div
        data-slot="scroll-area-viewport"
        className={cn(
          "size-full rounded-[inherit] transition-[color,box-shadow] outline-none",
        )}
      >
        {children}
      </div>
    </div>
  )
}

function ScrollBar() {
  // kept for compatibility if some code imports the named export, but no-op
  return null
}

export { ScrollArea, ScrollBar }
