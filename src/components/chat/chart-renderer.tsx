import { forwardRef } from 'react';
import ReactECharts from 'echarts-for-react';

interface ChartRendererProps {
    options: any;
    height?: string;
    theme?: 'light' | 'dark';
}

export const ChartRenderer = forwardRef<ReactECharts, ChartRendererProps>(
    ({ options, height = '400px', theme = 'light' }, ref) => {
        return (
            <ReactECharts
                ref={ref}
                option={options}
                style={{ height: height, width: '100%' }}
                theme={theme}
                opts={{ renderer: 'canvas' }}
            />
        );
    }
);

ChartRenderer.displayName = 'ChartRenderer';
