"use client";

import * as React from "react";
import useEmblaCarousel, {
  type UseEmblaCarouselType,
} from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type CarouselApi = UseEmblaCarouselType[1];

type CarouselContextProps = {
  carouselRef: UseEmblaCarouselType[0];
  api: CarouselApi;
  scrollPrev: () => void;
  scrollNext: () => void;
};

const CarouselContext = React.createContext<CarouselContextProps | null>(null);

function useCarousel() {
  const ctx = React.useContext(CarouselContext);
  if (!ctx) throw new Error("Carousel components must be used within <Carousel />");
  return ctx;
}

type CarouselProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Auto-advance the carousel on a loop. Defaults to on. */
  autoPlay?: boolean;
  /** Milliseconds between auto-advances. */
  autoPlayInterval?: number;
};

const Carousel = React.forwardRef<HTMLDivElement, CarouselProps>(
  ({ className, children, autoPlay = true, autoPlayInterval = 3500, ...props }, ref) => {
    const plugins = React.useMemo(
      () =>
        autoPlay
          ? [
              Autoplay({
                delay: autoPlayInterval,
                stopOnInteraction: false,
                stopOnMouseEnter: true,
              }),
            ]
          : [],
      [autoPlay, autoPlayInterval]
    );

    const [carouselRef, api] = useEmblaCarousel(
      { loop: true, align: "start" },
      plugins
    );

    const scrollPrev = React.useCallback(() => api?.scrollPrev(), [api]);
    const scrollNext = React.useCallback(() => api?.scrollNext(), [api]);

    return (
      <CarouselContext.Provider value={{ carouselRef, api, scrollPrev, scrollNext }}>
        <div ref={ref} className={cn("relative", className)} {...props}>
          {children}
        </div>
      </CarouselContext.Provider>
    );
  }
);
Carousel.displayName = "Carousel";

const CarouselContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
  const { carouselRef } = useCarousel();
  return (
    <div ref={carouselRef} className="-my-6 overflow-hidden py-6">
      <div ref={ref} className={cn("flex -ml-4", className)} {...props}>
        {children}
      </div>
    </div>
  );
});
CarouselContent.displayName = "CarouselContent";

const CarouselItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("min-w-0 shrink-0 grow-0 basis-full pl-4 md:basis-1/2", className)}
    {...props}
  />
));
CarouselItem.displayName = "CarouselItem";

function CarouselPrevious({ className }: { className?: string }) {
  const { scrollPrev } = useCarousel();
  return (
    <button
      onClick={scrollPrev}
      aria-label="Previous testimonial"
      className={cn(
        "focus-ring flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink text-ink transition-all duration-200 hover:-translate-y-0.5 hover:bg-ink hover:text-cream hover:shadow-lg hover:shadow-ink/20",
        className
      )}
    >
      <ArrowLeft size={16} />
    </button>
  );
}

function CarouselNext({ className }: { className?: string }) {
  const { scrollNext } = useCarousel();
  return (
    <button
      onClick={scrollNext}
      aria-label="Next testimonial"
      className={cn(
        "focus-ring flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink text-ink transition-all duration-200 hover:-translate-y-0.5 hover:bg-ink hover:text-cream hover:shadow-lg hover:shadow-ink/20",
        className
      )}
    >
      <ArrowRight size={16} />
    </button>
  );
}

export {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
};
