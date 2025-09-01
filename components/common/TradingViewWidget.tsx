import React, { useEffect, useRef, memo } from 'react';

// Make TradingView available on the window object
declare global {
  interface Window {
    TradingView: any;
  }
}

interface TradingViewWidgetProps {
  symbol: string;
  defaultInterval?: string;
}

const TradingViewWidget: React.FC<TradingViewWidgetProps> = ({ symbol, defaultInterval = "15" }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  // Using a stable ID for the container is more robust.
  // The widget's internal content will be replaced based on the symbol prop.
  const containerId = 'tradingview_widget_container';

  useEffect(() => {
    const widgetContainer = containerRef.current;
    if (!widgetContainer) {
      return;
    }

    const createAndRenderWidget = () => {
      if (!window.TradingView || !window.TradingView.widget) {
          console.error("TradingView script not loaded or container not ready.");
          return;
      }
      // Ensure the container is empty before rendering a new widget.
      // This is a robust way to clean up, avoiding potential issues with the library's remove() method.
      widgetContainer.innerHTML = '';

      new window.TradingView.widget({
        autosize: true,
        symbol: `BINANCE:${symbol}`,
        interval: defaultInterval,
        timezone: "Etc/UTC",
        theme: "dark",
        style: "1",
        locale: "fr",
        toolbar_bg: "#f1f3f6",
        enable_publishing: false,
        hide_side_toolbar: false,
        allow_symbol_change: true,
        container_id: containerId,
        details: true,
        hotlist: true,
        calendar: true,
      });
    };

    // Check if the TradingView script is already loaded.
    if (window.TradingView && window.TradingView.widget) {
      createAndRenderWidget();
    } else {
      // If not loaded, add a listener to the script tag.
      const script = document.querySelector('script[src="https://s3.tradingview.com/tv.js"]');
      script?.addEventListener('load', createAndRenderWidget, { once: true });
    }

    // When the component unmounts, we must clean up the container.
    return () => {
      if (widgetContainer) {
        widgetContainer.innerHTML = '';
      }
    };
  }, [symbol, defaultInterval, containerId]); // Re-run effect if the symbol or interval changes.

  return (
    <div 
      id={containerId} 
      ref={containerRef} 
      className="tradingview-widget-container h-[500px]"
    />
  );
};

export default memo(TradingViewWidget);