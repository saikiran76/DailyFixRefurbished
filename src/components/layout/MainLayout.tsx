import { useEffect, useState } from "react"
import { useSelector } from "react-redux"
import { AppSidebar } from "@/components/ui/app-sidebar"
// import {
//   Breadcrumb,
//   BreadcrumbItem,
//   BreadcrumbLink,
//   BreadcrumbList,
//   BreadcrumbPage,
//   BreadcrumbSeparator,
// } from "@/components/ui/breadcrumb"
// import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Settings as SettingsIcon, AlertTriangle } from "lucide-react"
import PlatformSettings from "@/components/PlatformSettings"

export default function Page() {
  // State to track if content below header is visible
  const [contentVisible, setContentVisible] = useState(true)
  // State to track if settings are open
  const [settingsOpen, setSettingsOpen] = useState(false)
  
  // Get onboarding state from Redux
  const onboardingState = useSelector((state: any) => state.onboarding)
  const { matrixConnected, whatsappConnected } = onboardingState
  
  // Check if any platform is connected
  const isPlatformConnected = matrixConnected || whatsappConnected
  
  // Toggle content visibility
  const toggleContent = () => {
    setContentVisible(prev => !prev)
  }
  
  // Listen for open-settings events
  useEffect(() => {
    const handleOpenSettings = () => {
      setSettingsOpen(true)
    }
    
    window.addEventListener('open-settings', handleOpenSettings)
    
    return () => {
      window.removeEventListener('open-settings', handleOpenSettings)
    }
  }, [])
  
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Main layout container with sidebar and content arranged horizontally */}
      <SidebarProvider
        className="w-full h-full"
        style={
          {
            "--sidebar-width": "400px",
          } as React.CSSProperties
        }
      >
        {/* This div ensures sidebar and content are properly positioned */}
        <div className="flex flex-row w-full h-full">
          {/* Sidebar container */}
          <AppSidebar />
          
          {/* Content area that takes remaining width */}
          <div className="flex-1 overflow-auto">
            {/* Left side - Inbox area */}
            <div className={`${settingsOpen ? 'w-[63%]' : 'w-full'} h-full transition-all duration-300`}>
              <SidebarInset className="flex flex-col h-full">
                {/* Header with the sidebar trigger */}
                <header className={`sticky top-0 flex shrink-0 items-center gap-2 bg-background p-4 border-b border-r border-gray-300/20 ${settingsOpen ? 'max-w-[90%]' : 'max-w-[65%]'}`}>
                  <SidebarTrigger className="flex items-center justify-center md:hidden" />
                  <div className="flex-1 ml-14 text-lg font-medium">Inbox</div>
                  {settingsOpen ? <></> : (<Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSettingsOpen(true)}
                    className="ml-auto"
                  >
                    <SettingsIcon className="h-5 w-5" />
                    <span className="sr-only">Settings</span>
                  </Button>)}
                  
                </header>
                
                {/* Content area */}
                <div 
                  className={`flex-1 flex flex-col gap-4 p-4 transition-all duration-300 ease-in-out overflow-auto ${settingsOpen ? 'max-w-[90%]' : 'max-w-[65%]'} ${
                    contentVisible ? 'opacity-100' : 'opacity-0 md:opacity-100 max-h-0 md:max-h-full'
                  }`}
                >
                  {!isPlatformConnected && (
                    <Card className={`border-2 border-yellow-600/30 bg-amber-950/10 shadow-lg mb-6 ${settingsOpen ? 'max-w-[100%]' : 'max-w-[70%]' } mx-auto`}>
                      <CardHeader className="bg-amber-950/20 pb-2">
                        <CardTitle className={`flex items-center text-amber-400 ${settingsOpen ? 'text-sm' : 'text-lg'}`}>
                          <AlertTriangle className="h-5 w-5 mr-2" />
                          No platforms connected
                        </CardTitle>
                        <CardDescription className={`text-amber-300/80 ${settingsOpen ? 'text-xs' : 'text-sm'}`}>
                          Connect to an account to start messaging
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pt-3 pb-4">
                        <p className={`text-sm text-muted-foreground ${settingsOpen ? 'text-xs' : 'text-sm'}`}>
                          You need to connect at least one messaging platform to use the inbox. 
                          Go to settings to connect your accounts.
                        </p>
                      </CardContent>
                      {settingsOpen ? 
                      <></>
                      : (
                        <CardFooter className="bg-amber-950/20 pt-3">
                        <Button 
                          onClick={() => setSettingsOpen(true)}
                          className="w-full"
                          variant="outline"
                        >
                          Go to Settings
                        </Button>
                      </CardFooter>
                      )}
                    </Card>
                  )}
                  
                  {/* Sample inbox content - normally would be a list of messages */}
                  {Array.from({ length: 24 }).map((_, index) => (
                    <div
                      key={index}
                      className="aspect-video h-12 w-full rounded-lg bg-muted/50"
                    />
                  ))}
                </div>
              </SidebarInset>
            </div>
            
            {/* Right side - Settings area (conditionally shown) */}
            {settingsOpen && (
              <div className="w-2/3 border-l border-gray-300/20 h-full transition-all duration-300 overflow-auto absolute right-0 top-0 bottom-0 bg-background">
                <div className="sticky top-0 z-10 flex items-center justify-between bg-background p-4 border-b border-gray-300/20">
                  <h2 className="text-lg font-semibold">Settings</h2>
                  <Button 
                    variant="ghost" 
                    size="icon"
                    onClick={() => setSettingsOpen(false)}
                  >
                    <span className="sr-only">Close</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                  </Button>
                </div>
                <div className="p-6">
                  <PlatformSettings />
                </div>
              </div>
            )}
          </div>
        </div>
      </SidebarProvider>
    </div>
  )
}
