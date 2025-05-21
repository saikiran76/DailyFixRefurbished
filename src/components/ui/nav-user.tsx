import {
  BadgeCheck,
  Bell,
  ChevronsUpDown,
  CreditCard,
  LogOut,
  Sparkles,
  User as UserIcon
} from "lucide-react"
import { useSelector } from "react-redux"
import { useNavigate } from "react-router-dom"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { toast } from "react-hot-toast"

export function NavUser() {
  const { isMobile } = useSidebar()
  const navigate = useNavigate()
  
  // Get auth state from Redux
  const authState = useSelector((state: any) => state.auth)
  const { session } = authState
  
  // Extract user data from session
  const userData = {
    id: session?.user?.id || "",
    email: session?.user?.email || "user@example.com",
    name: session?.user?.user_metadata?.full_name || session?.user?.email?.split("@")[0] || "User",
    avatar: session?.user?.user_metadata?.avatar_url || null
  }
  
  // Handle logout
  const handleLogout = () => {
    toast.success("Logged out successfully")
    navigate("/login")
  }

  return (
    <SidebarMenu className="w-full">
      <SidebarMenuItem className="w-full">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground md:h-8 md:p-0 w-full">
              <Avatar className="h-8 w-8 rounded-lg">
                {userData.avatar ? (
                  <AvatarImage src={userData.avatar} alt={userData.name} className="object-cover" />
                ) : (
                  <AvatarFallback className="rounded-lg bg-primary text-primary-foreground">
                    {userData.name.substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                )}
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{userData.name}</span>
                <span className="truncate text-xs">{userData.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg bg-black"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}>
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  {userData.avatar ? (
                    <AvatarImage src={userData.avatar} alt={userData.name} className="object-cover" />
                  ) : (
                    <AvatarFallback className="rounded-lg bg-primary text-primary-foreground">
                      {userData.name.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  )}
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{userData.name}</span>
                  <span className="truncate text-xs">{userData.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem className="hover:bg-neutral-700 cursor-pointer">
                <Sparkles className="mr-2 h-4 w-4" />
                <span>Upgrade to Pro</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem className="hover:bg-neutral-700 duration-150 cursor-pointer">
                <UserIcon className="mr-2 h-4 w-4" />
                <span>Account</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="hover:bg-neutral-700 cursor-pointer">
                <CreditCard className="mr-2 h-4 w-4" />
                <span>Billing</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="hover:bg-neutral-700 cursor-pointer">
                <Bell className="mr-2 h-4 w-4" />
                <span>Notifications</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="hover:bg-neutral-700 cursor-pointer" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
