import React, { useState } from 'react';
import {
     Accordion,
     AccordionContent,
     AccordionItem,
     AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button";
import { Play, Info } from "lucide-react";
import TutorialCarousel from '@/components/ui/TutorialCarousel';
import logger from '@/utils/logger';
   
export function Help() {
     const [showTutorial, setShowTutorial] = useState(false);

     const handleStartTutorial = () => {
          logger.info('[Help] User started tutorial from Help Center');
          setShowTutorial(true);
     };

     const handleTutorialComplete = () => {
          logger.info('[Help] Tutorial completed from Help Center');
          setShowTutorial(false);
     };

     const handleTutorialSkip = () => {
          logger.info('[Help] Tutorial skipped from Help Center');
          setShowTutorial(false);
     };

     return (
          <>
               <div className="mb-4 flex items-center gap-4">
                    <Button 
                         onClick={handleStartTutorial} 
                         className="flex items-center gap-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white border-0"
                    >
                         <Play className="h-4 w-4" />
                         Start App Tutorial
                    </Button>
                    <div className="text-xs text-gray-400">
                         <Info className="h-3 w-3 inline mr-1" />
                         Learn how to use DailyFix
                    </div>
               </div>

               <Accordion
                    type="single"
                    collapsible
                    className="w-full"
                    defaultValue="item-1"
               >
                    <AccordionItem value="item-1">
                         <AccordionTrigger>Product Information</AccordionTrigger>
                         <AccordionContent className="flex flex-col gap-4 text-balance">
                              <p>
                              Our flagship product combines cutting-edge technology with sleek
                              design. Built with premium materials, it offers unparalleled
                              performance and reliability.
                              </p>
                              <p>
                              Key features include advanced processing capabilities, and an
                              intuitive user interface designed for both beginners and experts.
                              </p>
                         </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="item-2">
                         <AccordionTrigger>Shipping Details</AccordionTrigger>
                         <AccordionContent className="flex flex-col gap-4 text-balance">
                              <p>
                              We offer worldwide shipping through trusted courier partners.
                              Standard delivery takes 3-5 business days, while express shipping
                              ensures delivery within 1-2 business days.
                              </p>
                              <p>
                              All orders are carefully packaged and fully insured. Track your
                              shipment in real-time through our dedicated tracking portal.
                              </p>
                         </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="item-3">
                         <AccordionTrigger>Return Policy</AccordionTrigger>
                         <AccordionContent className="flex flex-col gap-4 text-balance">
                              <p>
                              We stand behind our products with a comprehensive 30-day return
                              policy. If you&apos;re not completely satisfied, simply return the
                              item in its original condition.
                              </p>
                              <p>
                              Our hassle-free return process includes free return shipping and
                              full refunds processed within 48 hours of receiving the returned
                              item.
                              </p>
                         </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="item-4">
                         <AccordionTrigger>DailyFix Usage Guide</AccordionTrigger>
                         <AccordionContent className="flex flex-col gap-4 text-balance">
                              <p>
                              DailyFix connects your messaging platforms (WhatsApp and Telegram) in one place.
                              To get started, use the platform switcher in the sidebar to connect your accounts.
                              </p>
                              <p>
                              You can refresh your contacts list anytime by clicking the refresh button. If you
                              switch between platforms and don't see updated contacts, try refreshing.
                              </p>
                              <p>
                              For a more detailed guide, click the "Start App Tutorial" button above.
                              </p>
                         </AccordionContent>
                    </AccordionItem>
               </Accordion>

               {/* Tutorial overlay */}
               {showTutorial && (
                    <TutorialCarousel 
                         onComplete={handleTutorialComplete}
                         onSkip={handleTutorialSkip}
                    />
               )}
          </>
     )
}
   