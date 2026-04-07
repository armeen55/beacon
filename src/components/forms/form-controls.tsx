import { cn } from "@/lib/utils";

export function FormField({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
        {required && <span className="text-status-danger ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-[11px] text-status-danger">{error}</p>}
    </div>
  );
}

export function FormInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-md border border-border bg-background px-3 py-1.5 text-[13px]",
        "placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent-primary/40 focus:border-accent-primary/40",
        "transition-colors",
        className
      )}
      {...props}
    />
  );
}

export function FormSelect({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "w-full rounded-md border border-border bg-background px-3 py-1.5 text-[13px]",
        "focus:outline-none focus:ring-1 focus:ring-accent-primary/40 focus:border-accent-primary/40",
        "transition-colors cursor-pointer",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function FormTextarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-md border border-border bg-background px-3 py-1.5 text-[13px] leading-relaxed",
        "placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent-primary/40 focus:border-accent-primary/40",
        "transition-colors resize-none",
        className
      )}
      rows={3}
      {...props}
    />
  );
}
