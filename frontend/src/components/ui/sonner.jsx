import { Toaster as Sonner, toast } from "sonner"
import { useTheme } from "@/contexts/ThemeContext"

const Toaster = ({
  ...props
}) => {
  // `theme` es el id del tema (fresco/restaurante/cálido); lo que decide el
  // claro/oscuro es `darkMode`.
  const { darkMode = false } = useTheme()

  return (
    <Sonner
      theme={darkMode ? "dark" : "light"}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props} />
  );
}

export { Toaster, toast }
