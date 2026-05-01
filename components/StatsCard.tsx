import React from 'react';

interface StatsCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  description?: string;
}

export const StatsCard: React.FC<StatsCardProps> = ({ label, value, icon, description }) => {
  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col gap-1 transition-all hover:shadow-md">
      <div className="flex items-center justify-between mb-2">
        <span className="text-slate-500 font-medium text-sm">{label}</span>
        <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
          {icon}
        </div>
      </div>
      <div className="text-3xl font-bold text-slate-800">{value}</div>
      {description && <p className="text-xs text-slate-400 mt-1">{description}</p>}
    </div>
  );
};
