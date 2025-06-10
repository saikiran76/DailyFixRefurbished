import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner"

const Toaster = ({
  ...props
}) => {
  const { theme = "dark" } = useTheme()

  return (
    (<Sonner
      theme={theme as "dark" | "light" | "system"}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-blue-900/20 group-[.toaster]:text-blue-200 group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:font-['IBM_Plex_Sans',_sans-serif]",
          description: "group-[.toast]:text-muted-foreground group-[.toast]:font-['IBM_Plex_Sans',_sans-serif]",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:font-['IBM_Plex_Sans',_sans-serif]",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground group-[.toast]:font-['IBM_Plex_Sans',_sans-serif]",
        },
      }}
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      }}
      {...props} />)
  );
}

export { Toaster }
