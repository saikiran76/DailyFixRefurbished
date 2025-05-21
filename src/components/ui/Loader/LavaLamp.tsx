import React from 'react';
import './LavaLamp.css';

interface LavaLampProps {
  className?: string;
}

const LavaLamp: React.FC<LavaLampProps> = ({ className = '' }) => {
  return (
    <div className={`relative w-[50px] h-[100px] bg-black rounded-[25px] overflow-hidden ${className}`}>
      <div className="absolute top-0 w-[20px] h-[20px] rounded-full left-[15px] bubble"></div>
      <div className="absolute top-0 w-[20px] h-[20px] rounded-full left-[1px] bubble1"></div>
      <div className="absolute top-0 w-[20px] h-[20px] rounded-full left-[30px] bubble2"></div>
      <div className="absolute top-0 w-[20px] h-[20px] rounded-full left-[20px] bubble3"></div>
    </div>
  );
};

export default LavaLamp;