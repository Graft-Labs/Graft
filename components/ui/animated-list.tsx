"use client"

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react"
import { AnimatePresence, motion, type MotionProps } from "motion/react"

import { cn } from "@/lib/utils"

export function AnimatedListItem({ children }: { children: React.ReactNode }) {
  const animations: MotionProps = {
    initial: { scale: 0, opacity: 0 },
    animate: { scale: 1, opacity: 1, originY: 0 },
    exit: { scale: 0, opacity: 0 },
    transition: { type: "spring", stiffness: 350, damping: 40 },
  }

  return (
    <motion.div {...animations} layout className="mx-auto w-full">
      {children}
    </motion.div>
  )
}

export interface AnimatedListProps extends ComponentPropsWithoutRef<"div"> {
  children: React.ReactNode
  delay?: number
  maxItems?: number
}

export const AnimatedList = React.memo(
  ({
    children,
    className,
    delay = 1000,
    maxItems = 6,
    ...props
  }: AnimatedListProps) => {
    const [index, setIndex] = useState(0)
    const [feed, setFeed] = useState<Array<{ id: number; node: React.ReactNode }>>(
      []
    )
    const nextId = useRef(0)
    const childrenArray = useMemo(
      () => React.Children.toArray(children),
      [children]
    )

    useEffect(() => {
      if (childrenArray.length === 0) {
        setFeed([])
        setIndex(0)
        nextId.current = 0
        return
      }

      nextId.current = 1
      setIndex(1 % childrenArray.length)
      setFeed([{ id: 0, node: childrenArray[0] }])
    }, [childrenArray])

    useEffect(() => {
      if (childrenArray.length === 0) {
        return
      }

      let timeout: ReturnType<typeof setTimeout> | null = null

      timeout = setTimeout(() => {
        setFeed((prev) => {
          const next = [...prev, { id: nextId.current++, node: childrenArray[index] }]
          if (next.length > maxItems) {
            next.shift()
          }
          return next
        })
        setIndex((prevIndex) => (prevIndex + 1) % childrenArray.length)
      }, delay)

      return () => {
        if (timeout !== null) {
          clearTimeout(timeout)
        }
      }
    }, [index, delay, maxItems, childrenArray])

    const itemsToShow = useMemo(() => {
      return [...feed].reverse()
    }, [feed])

    return (
      <div
        className={cn(`flex flex-col items-center gap-4`, className)}
        {...props}
      >
        <AnimatePresence>
          {itemsToShow.map((item) => (
            <AnimatedListItem key={item.id}>
              {item.node}
            </AnimatedListItem>
          ))}
        </AnimatePresence>
      </div>
    )
  }
)

AnimatedList.displayName = "AnimatedList"
