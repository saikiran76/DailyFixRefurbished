import * as React from 'react';

// Component interfaces
export interface SidebarProviderProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "inset" | "default";
  side?: "left" | "right";
  collapsible?: "icon" | "full" | false;
  children?: React.ReactNode;
}

export interface SidebarTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  onClick?: () => void;
  className?: string;
}

export interface SidebarMenuButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isActive?: boolean;
  className?: string;
  tooltip?: string;
  variant: string;
  size: string;
}

export interface SidebarMenuBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

// Components export
export const SidebarProvider: React.FC<SidebarProviderProps>;
export const Sidebar: React.FC<SidebarProps>;
export const SidebarHeader: React.FC<React.HTMLAttributes<HTMLDivElement>>;
export const SidebarContent: React.FC<React.HTMLAttributes<HTMLDivElement>>;
export const SidebarFooter: React.FC<React.HTMLAttributes<HTMLDivElement>>;
export const SidebarGroup: React.FC<React.HTMLAttributes<HTMLDivElement>>;
export const SidebarGroupLabel: React.FC<React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }>;
export const SidebarGroupContent: React.FC<React.HTMLAttributes<HTMLDivElement>>;
export const SidebarMenu: React.FC<React.HTMLAttributes<HTMLDivElement>>;
export const SidebarMenuItem: React.FC<React.HTMLAttributes<HTMLDivElement>>;
export const SidebarMenuButton: React.FC<SidebarMenuButtonProps>;
export const SidebarMenuBadge: React.FC<SidebarMenuBadgeProps>;
export const SidebarTrigger: React.FC<SidebarTriggerProps>;
export const SidebarInset: React.FC<React.HTMLAttributes<HTMLDivElement>>;

// Hooks
export function useSidebar(): {
  open: boolean;
  setOpen: (open: boolean) => void;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}; 