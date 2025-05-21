import * as React from "react"
import { twMerge } from "tailwind-merge"

function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  className?: string;
}) {
  return (
    <div
      className={twMerge(
        "rounded-xl border bg-card text-card-foreground shadow p-6",
        className
      )}
      {...props}>
      {children}
    </div>
  );
}

function CardHeader({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  className?: string;
}) {
  return (
    <div
      className={twMerge(
        "flex flex-col space-y-1.5 pb-4",
        className
      )}
      {...props}>
      {children}
    </div>
  );
}

function CardTitle({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & {
  className?: string;
}) {
  return (
    <h3
      className={twMerge("text-2xl font-semibold leading-none tracking-tight", className)}
      {...props}>
      {children}
    </h3>
  );
}

function CardDescription({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement> & {
  className?: string;
}) {
  return (
    <p
      className={twMerge("text-sm text-muted-foreground mt-2", className)}
      {...props}>
      {children}
    </p>
  );
}

function CardAction({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  className?: string;
}) {
  return (
    <div
      data-slot="card-action"
      className={twMerge(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}>
      {children}
    </div>
  );
}

function CardContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  className?: string;
}) {
  return (
    <div 
      className={twMerge("py-4", className)} 
      {...props}
    >
      {children}
    </div>
  );
}

function CardFooter({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  className?: string;
}) {
  return (
    <div
      className={twMerge("flex items-center pt-4", className)}
      {...props}>
      {children}
    </div>
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
