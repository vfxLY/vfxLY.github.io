
import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'outline';
}

const Button: React.FC<ButtonProps> = ({ 
  children, 
  loading, 
  variant = 'primary', 
  className = '', 
  ...props 
}) => {
  const baseStyles = "relative w-full py-4 px-8 rounded-2xl font-black text-[12px] uppercase tracking-[0.2em] transition-all duration-500 transform active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-3 overflow-hidden group border";
  
  const variants = {
    primary: "bg-slate-950 text-white border-transparent shadow-[0_20px_40px_rgba(0,0,0,0.2)] hover:shadow-[0_30px_60px_rgba(0,0,0,0.3)] hover:bg-black",
    secondary: "bg-white text-slate-950 border-slate-100 shadow-premium hover:bg-slate-50 hover:border-slate-200",
    outline: "bg-transparent border-slate-200 text-slate-500 hover:border-slate-950 hover:text-slate-950",
  };

  return (
    <button 
      className={`${baseStyles} ${variants[variant]} ${className}`} 
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? (
        <>
          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-current opacity-60" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="opacity-60">Synchronizing...</span>
        </>
      ) : (
        children
      )}
      
      {!loading && variant === 'primary' && (
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 ease-in-out"></div>
      )}
    </button>
  );
};

export default Button;
