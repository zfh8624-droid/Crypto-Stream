import * as React from "react";

interface SimpleTabsProps {
  defaultValue: string;
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

interface SimpleTabsListProps {
  children: React.ReactNode;
  className?: string;
}

interface SimpleTabsTriggerProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

interface SimpleTabsContentProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

interface TabsContextType {
  value: string;
  onValueChange: (value: string) => void;
}

const TabsContext = React.createContext<TabsContextType | null>(null);

export function SimpleTabs({ 
  defaultValue, 
  value: controlledValue, 
  onValueChange, 
  children, 
  className 
}: SimpleTabsProps) {
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  
  const value = controlledValue !== undefined ? controlledValue : internalValue;
  
  const handleValueChange = (newValue: string) => {
    if (onValueChange) {
      onValueChange(newValue);
    } else {
      setInternalValue(newValue);
    }
  };

  return (
    <TabsContext.Provider value={{ value, onValueChange: handleValueChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function SimpleTabsList({ children, className }: SimpleTabsListProps) {
  return (
    <div className={`inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 ${className || ""}`}>
      {children}
    </div>
  );
}

export function SimpleTabsTrigger({ value, children, className }: SimpleTabsTriggerProps) {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error("SimpleTabsTrigger must be used within SimpleTabs");
  
  const isActive = context.value === value;
  
  return (
    <button
      type="button"
      onClick={() => context.onValueChange(value)}
      className={`
        inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium
        ${isActive ? "bg-background text-foreground shadow" : "text-muted-foreground"}
        ${className || ""}
      `}
    >
      {children}
    </button>
  );
}

export function SimpleTabsContent({ value, children, className }: SimpleTabsContentProps) {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error("SimpleTabsContent must be used within SimpleTabs");
  
  const isActive = context.value === value;
  
  if (!isActive) return null;
  
  return (
    <div className={className}>
      {children}
    </div>
  );
}
