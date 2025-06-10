import { useEffect } from 'react';

export const useMousePosition = () => {
  useEffect(() => {
    const syncPointer = ({ x, y }: { x: number; y: number }) => {
      document.documentElement.style.setProperty('--px', x.toFixed(2));
      document.documentElement.style.setProperty('--py', y.toFixed(2));
    };

    const handleMouseMove = (event: MouseEvent) => {
      syncPointer({ x: event.clientX, y: event.clientY });
    };

    document.body.addEventListener('pointermove', handleMouseMove);
    
    return () => {
      document.body.removeEventListener('pointermove', handleMouseMove);
    };
  }, []);
};
