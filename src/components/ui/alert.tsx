import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority";
import { twMerge } from "tailwind-merge";

const alertVariants = cva(
  "relative w-full rounded-lg border p-4 text-sm flex items-start gap-3",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        destructive:
          "bg-destructive/10 text-destructive border-destructive/30 dark:border-destructive [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

function Alert({
  className,
  variant,
  children,
  ...props
}: AlertProps) {
  return (
    <div
      role="alert"
      className={twMerge(alertVariants({ variant }), className)}
      {...props}>
      {children}
    </div>
  );
}

function AlertTitle({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & {
  className?: string;
}) {
  return (
    <h5
      className={twMerge("mb-1 font-medium leading-none tracking-tight", className)}
      {...props}>
      {children}
    </h5>
  );
}

function AlertDescription({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement> & {
  className?: string;
}) {
  return (
    <div
      className={twMerge("text-sm [&_p]:leading-relaxed", className)}
      {...props}>
      {children}
    </div>
  );
}

export { Alert, AlertTitle, AlertDescription }
