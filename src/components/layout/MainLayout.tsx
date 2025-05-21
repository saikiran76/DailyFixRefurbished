import { AppSidebar } from "@/components/ui/app-sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { useState } from "react"

export default function Page() {
  // State to track if content below header is visible
  const [contentVisible, setContentVisible] = useState(true)
  
  // Toggle content visibility
  const toggleContent = () => {
    setContentVisible(prev => !prev)
  }
  
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Main layout container with sidebar and content arranged horizontally */}
      <SidebarProvider
        style={
          {
            "--sidebar-width": "400px",
          } as React.CSSProperties
        }
      >
        {/* This div ensures sidebar and content are properly positioned */}
        <div className="flex flex-row w-full h-full">
          {/* Sidebar container with proper width and positioning */}
          <div className="h-full">
            <AppSidebar />
          </div>
          
          {/* Content area that takes remaining width */}
          <div className="flex-1 overflow-auto">
            <SidebarInset className="flex flex-col h-full">
              {/* Header with the sidebar trigger */}
              <header className="flex shrink-0 items-center gap-2 bg-background p-4">
                <SidebarTrigger 
                  className="flex items-center justify-center"
                  onClick={toggleContent}
                />
              </header>
              
              {/* Content area */}
              <div 
                className={`flex-1 flex flex-col gap-4 p-4 transition-all duration-300 ease-in-out overflow-hidden ${
                  contentVisible ? 'opacity-100' : 'opacity-0 md:opacity-100 max-h-0 md:max-h-full'
                }`}
              >
                {Array.from({ length: 24 }).map((_, index) => (
                  <div
                    key={index}
                    className="aspect-video h-12 w-full rounded-lg bg-muted/50"
                  />
                ))}
              </div>
            </SidebarInset>
          </div>
        </div>
      </SidebarProvider>
    </div>
  )
}
