"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"
import { useIsMobile } from "@/hooks/useIsMobile"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/60 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

// Interactive element tags — mousedown on these should not initiate drag
const NO_DRAG_TAGS = new Set(["input", "textarea", "select", "button", "a", "label"])

/** Tailwind's `sm`. Must stay in sync with the `max-sm:` full-screen classes
 *  below: the JS gate and the CSS have to flip at the same width, or in the
 *  band between them the dialog drops its centering transform without ever
 *  getting the full-screen layout that replaces it. */
const SM_BREAKPOINT = 640

function DialogContent({
  className,
  children,
  showCloseButton = true,
  mobileFullScreen = false,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  /** Fill the viewport on small screens instead of the default centered,
   *  draggable card — dragging a full-screen sheet makes no sense, so this
   *  also disables the mousedown-drag handler below on mobile. Desktop is
   *  untouched (the prop only changes anything under the `sm` breakpoint). */
  mobileFullScreen?: boolean
}) {
  const isMobile = useIsMobile(SM_BREAKPOINT)
  const [offset, setOffset] = React.useState({ x: 0, y: 0 })
  const drag = React.useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const isDragging = React.useRef(false)
  const fullScreen = mobileFullScreen && isMobile

  function onMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    const tag = (e.target as HTMLElement).tagName.toLowerCase()
    if (NO_DRAG_TAGS.has(tag)) return
    if ((e.target as HTMLElement).closest("button, input, textarea, select, [data-no-drag]")) return
    drag.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y }
    isDragging.current = false

    const onMove = (ev: MouseEvent) => {
      if (!drag.current) return
      isDragging.current = true
      setOffset({
        x: drag.current.ox + ev.clientX - drag.current.sx,
        y: drag.current.oy + ev.clientY - drag.current.sy,
      })
    }
    const onUp = () => {
      drag.current = null
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    e.preventDefault()
  }

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] cursor-move gap-4 rounded-xl bg-tv-popup p-4 text-sm text-popover-foreground ring-1 ring-tv-border-strong outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
          mobileFullScreen &&
            "max-sm:inset-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:w-screen max-sm:max-w-none max-sm:cursor-default max-sm:overflow-y-auto max-sm:rounded-none",
          className
        )}
        style={
          fullScreen
            ? undefined
            : {
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
              }
        }
        onMouseDown={fullScreen ? undefined : onMouseDown}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            data-no-drag
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
