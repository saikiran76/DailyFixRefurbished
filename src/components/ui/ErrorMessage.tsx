import React, { useRef, useEffect } from 'react';
import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';

// Register the SplitText plugin with GSAP
gsap.registerPlugin(SplitText);

// Define the props interface for TypeScript
interface ErrorMessageProps {
  message?: string;
}

// Define the reusable ErrorMessage component
const ErrorMessage: React.FC<ErrorMessageProps> = ({
  message = "something went wrong, Try again later",
}) => {
  // Create refs for DOM elements to animate
  const copyRef = useRef<HTMLParagraphElement>(null);
  const handleRef = useRef<HTMLSpanElement>(null);
  const replayRef = useRef<SVGSVGElement>(null);

  // Set up animations when the component mounts
  useEffect(() => {
    // Ensure refs are available
    if (!copyRef.current || !handleRef.current || !replayRef.current) return;

    // Initialize SplitText to split the text into characters and words
    const split = new SplitText(copyRef.current, { type: "chars, words" });
    const handle = handleRef.current;
    const replay = replayRef.current;

    // Create a GSAP timeline for the animations
    const tl = gsap.timeline({ paused: true });

    // Animate text characters with a stagger effect
    tl.staggerFrom(
      split.chars,
      0.001,
      {
        autoAlpha: 0,
        ease: "back.inOut(1.7)",
      },
      0.05
    )
      // Blink the handle concurrently with the text animation
      .fromTo(
        handle,
        { autoAlpha: 0 },
        { autoAlpha: 1, repeat: -1, yoyo: true, duration: 0.4 },
        0
      )
      // Move the handle across the text after the text animation completes
      .to(
        handle,
        {
          x: () => copyRef.current!.getBoundingClientRect().width,
          ease: "steps(12)",
          duration: 0.7,
        },
        ">"
      );

    // Start the animation with a 0.2-second delay
    tl.delay(0.2).play();

    // Handle replay button click to restart the animation
    const replayHandler = () => {
      split.revert(); // Revert the DOM changes made by SplitText
      split.split({ type: "chars, words" }); // Re-split the text
      tl.restart(); // Restart the animation timeline
    };

    replay.addEventListener("click", replayHandler);

    // Cleanup event listener and revert SplitText on unmount
    return () => {
      replay.removeEventListener("click", replayHandler);
      split.revert();
    };
  }, []);

  return (
    // Outer container with full width and relative positioning
    <div className="w-full relative">
      {/* Centered container for the text and handle */}
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center">
        {/* Text with Tailwind styling and font */}
        <p ref={copyRef} className="text-white text-2xl">
          {message}
        </p>
        {/* Animated handle */}
        <span
          ref={handleRef}
          className="bg-yellow-500 w-[14px] h-[30px] absolute top-0 left-0 mt-[1px]"
        ></span>
      </div>
      {/* Replay SVG button */}
      <svg
        ref={replayRef}
        className="w-5 m-[15px] absolute bottom-0 right-0 cursor-pointer fill-[#666] hover:fill-[#888]"
        viewBox="0 0 279.9 297.3"
      >
        <g>
          <path d="M269.4,162.6c-2.7,66.5-55.6,120.1-121.8,123.9c-77,4.4-141.3-60-136.8-136.9C14.7,81.7,71,27.8,140,27.8
            c1.8,0,3.5,0,5.3,0.1c0.3,0,0.5,0.2,0.5,0.5v15c0,1.5,1.6,2.4,2.9,1.7l35.9-20.7c1.3-0.7,1.3-2.6,0-3.3L148.6,0.3
            c-1.3-0.7-2.9,0.2-2.9,1.7v15c0,0.3-0.2,0.5-0.5,0.5c-1.7-0.1-3.5-0.1-5.2-0.1C63.3,17.3,1,78.9,0,155.4
            C-1,233.8,63.4,298.3,141.9,297.3c74.6-1,135.1-60.2,138-134.3c0.1-3-2.3-5.4-5.3-5.4l0,0C271.8,157.6,269.5,159.8,269.4,162.6z" />
        </g>
      </svg>
    </div>
  );
};

export default ErrorMessage;