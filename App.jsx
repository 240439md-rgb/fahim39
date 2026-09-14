import React, { useState, useRef, useMemo } from "react";
import * as GeoTIFF from "geotiff";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell as RechartCell } from "recharts";
import "./App.css";

function App() {
  const [image, setImage] = useState(null);
  const [imageName, setImageName] = useState("");
  const [grid, setGrid] = useState([]);
  const [rows, setRows] = useState(6);
  const [cols, setCols] = useState(6);
  const [colorScheme, setColorScheme] = useState("viridis");
  const [normType, setNormType] = useState("minmax");
  const [selectedCell, setSelectedCell] = useState(null);
  const [isNormalized, setIsNormalized] = useState(false);
  const [threshold, setThreshold] = useState(0);

  const imageRef = useRef(null);

  // 1. File Upload (JPG, PNG, TIFF)
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setImageName(file.name);
    setSelectedCell(null);
    setIsNormalized(false);
    setGrid([]);
    setThreshold(0);

    const ext = file.name.split(".").pop().toLowerCase();

    if (ext === "tif" || ext === "tiff") {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
        const tiffImage = await tiff.getImage();
        const rasters = await tiffImage.readRasters();
        
        const width = tiffImage.getWidth();
        const height = tiffImage.getHeight();
        const data = rasters[0];

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        const imgData = ctx.createImageData(width, height);

        let min = Infinity, max = -Infinity;
        for (let i = 0; i < data.length; i++) {
          if (data[i] < min) min = data[i];
          if (data[i] > max) max = data[i];
        }
        const range = max - min || 1;

        for (let i = 0; i < data.length; i++) {
          const val = Math.floor(((data[i] - min) / range) * 255);
          const idx = i * 4;
          imgData.data[idx] = val;
          imgData.data[idx + 1] = val;
          imgData.data[idx + 2] = val;
          imgData.data[idx + 3] = 255;
        }

        ctx.putImageData(imgData, 0, 0);
        const url = canvas.toDataURL();

        const img = new Image();
        img.onload = () => {
          imageRef.current = img;
          setImage(url);
        };
        img.src = url;
      } catch (err) {
        alert("Error reading TIFF file.");
      }
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          imageRef.current = img;
          setImage(event.target.result);
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    }
  };

  // 2. Grid Generation
  const generateGrid = () => {
    if (!imageRef.current) return;

    const img = imageRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);

    const cellW = canvas.width / cols;
    const cellH = canvas.height / rows;
    const newGrid = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const imgData = ctx.getImageData(c * cellW, r * cellH, cellW, cellH).data;
        let sum = 0;
        let count = 0;

        for (let i = 0; i < imgData.length; i += 4) {
          sum += 0.299 * imgData[i] + 0.587 * imgData[i + 1] + 0.114 * imgData[i + 2];
          count++;
        }

        const avg = sum / count;
        newGrid.push({ row: r, col: c, rawVal: avg, normVal: null });
      }
    }

    setGrid(newGrid);
    setIsNormalized(false);
    setSelectedCell(null);
  };

  // 3. Statistical Calculations Engine
  const statistics = useMemo(() => {
    if (!grid.length) return null;
    const values = grid.map((cell) => (isNormalized ? cell.normVal : cell.rawVal));
    
    const min = Math.min(...values);
    const max = Math.max(...values);
    const sum = values.reduce((acc, curr) => acc + curr, 0);
    const mean = sum / values.length;

    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

    const variance = values.reduce((acc, curr) => acc + Math.pow(curr - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    return { min, max, mean, median, stdDev, variance };
  }, [grid, isNormalized]);

  // 4. Normalization Engine (Min-Max & Z-Score)
  const normalizeGrid = () => {
    if (!grid.length || !statistics) return;

    let updatedGrid = [];
    if (normType === "minmax") {
      const rawValues = grid.map((c) => c.rawVal);
      const min = Math.min(...rawValues);
      const max = Math.max(...rawValues);
      const range = max - min || 1;

      updatedGrid = grid.map((cell) => ({
        ...cell,
        normVal: Number(((cell.rawVal - min) / range).toFixed(3)),
      }));
    } else {
      const { mean, stdDev } = statistics;
      const safeStd = stdDev || 1;

      updatedGrid = grid.map((cell) => ({
        ...cell,
        normVal: Number(((cell.rawVal - mean) / safeStd).toFixed(3)),
      }));
    }

    setGrid(updatedGrid);
    setIsNormalized(true);
  };

  // 5. Histogram Data Builder
  const histogramData = useMemo(() => {
    if (!grid.length) return [];
    const bins = Array(5).fill(0);
    
    if (isNormalized && normType === "minmax") {
      grid.forEach((c) => {
        const val = c.normVal ?? 0;
        const binIdx = Math.min(4, Math.floor(val * 5));
        bins[binIdx]++;
      });
      return [
        { range: "0.0 - 0.2", count: bins[0] },
        { range: "0.2 - 0.4", count: bins[1] },
        { range: "0.4 - 0.6", count: bins[2] },
        { range: "0.6 - 0.8", count: bins[3] },
        { range: "0.8 - 1.0", count: bins[4] },
      ];
    } else {
      const rawValues = grid.map((c) => c.rawVal);
      const min = Math.min(...rawValues);
      const max = Math.max(...rawValues);
      const step = (max - min) / 5 || 1;

      grid.forEach((c) => {
        const binIdx = Math.min(4, Math.floor((c.rawVal - min) / step));
        bins[binIdx]++;
      });

      return bins.map((b, i) => ({
        range: `${Math.round(min + i * step)}-${Math.round(min + (i + 1) * step)}`,
        count: b,
      }));
    }
  }, [grid, isNormalized, normType]);

  // 6. Color Mapping Logic
  const getCellColor = (val) => {
    let normalizedRatio = val;
    
    if (normType === "zscore" && isNormalized) {
      normalizedRatio = Math.max(0, Math.min(1, (val + 2) / 4));
    }

    if (colorScheme === "heatmap") {
      const r = Math.floor(255 * normalizedRatio);
      const b = Math.floor(255 * (1 - normalizedRatio));
      return { bg: `rgba(${r}, 40, ${b}, 0.88)`, isDark: normalizedRatio < 0.6 };
    } 
    if (colorScheme === "viridis") {
      const r = Math.floor(35 + normalizedRatio * 220);
      const g = Math.floor(10 + normalizedRatio * 180);
      const b = Math.floor(120 + (1 - normalizedRatio) * 100);
      return { bg: `rgba(${r}, ${g}, ${b}, 0.88)`, isDark: normalizedRatio < 0.5 };
    }
    const g = Math.floor(normalizedRatio * 255);
    return { bg: `rgba(${g}, ${g}, ${g}, 0.88)`, isDark: normalizedRatio < 0.55 };
  };

  // 7. Download Engine
  const downloadImage = () => {
    if (!grid.length || !isNormalized) return;

    const canvas = document.createElement("canvas");
    canvas.width = cols * 120;
    canvas.height = rows * 120;
    const ctx = canvas.getContext("2d");

    grid.forEach((cell) => {
      let ratio = cell.normVal;
      if (normType === "zscore") {
        ratio = Math.max(0, Math.min(1, (cell.normVal + 2) / 4));
      }

      const { bg } = getCellColor(ratio);
      ctx.fillStyle = bg;
      ctx.fillRect(cell.col * 120, cell.row * 120, 120, 120);

      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.lineWidth = 1;
      ctx.strokeRect(cell.col * 120, cell.row * 120, 120, 120);

      if (normType === "minmax" && cell.normVal < threshold) {
        ctx.fillStyle = "#ef4444";
        ctx.font = "bold 13px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("MASKED", cell.col * 120 + 60, cell.row * 120 + 65);
      } else {
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 15px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(cell.normVal, cell.col * 120 + 60, cell.row * 120 + 65);
      }
    });

    const link = document.createElement("a");
    link.download = `F39_GEO_${colorScheme}_${imageName.split(".")[0] || "raster"}.png`;
    link.href = canvas.toDataURL();
    link.click();
  };

  return (
    <div className="app-container">
      {/* Top Professional Header */}
      <header className="app-header">
        <div className="header-brand">
          <div className="brand-logo">F39</div>
          <div>
            <h1>F39 GEO</h1>
            <p className="subtitle">Spatial Analytics & Raster Workbench</p>
          </div>
        </div>
        <div className="header-status">
          <span className={`status-badge ${image ? "active" : ""}`}>
            {image ? "Layer Active" : "No Raster Loaded"}
          </span>
        </div>
      </header>

      {/* Control Panel Grid */}
      <section className="controls-panel">
        <div className="control-card">
          <span className="card-label">DATA SOURCE</span>
          <label className="file-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span>{imageName ? imageName : "Upload Raster/TIFF"}</span>
            <input type="file" accept=".jpg,.jpeg,.png,.tif,.tiff" onChange={handleFileUpload} />
          </label>
        </div>

        <div className="control-card">
          <span className="card-label">GRID MATRIX</span>
          <div className="grid-inputs">
            <label>R: <input type="number" value={rows} onChange={(e) => setRows(Number(e.target.value))} min="1" max="30" /></label>
            <label>C: <input type="number" value={cols} onChange={(e) => setCols(Number(e.target.value))} min="1" max="30" /></label>
          </div>
        </div>

        <div className="control-card">
          <span className="card-label">ANALYSIS METHOD</span>
          <select value={normType} onChange={(e) => setNormType(e.target.value)}>
            <option value="minmax">Min-Max (0 to 1)</option>
            <option value="zscore">Z-Score (Standardized)</option>
          </select>
        </div>

        <div className="control-card">
          <span className="card-label">PALETTE</span>
          <select value={colorScheme} onChange={(e) => setColorScheme(e.target.value)}>
            <option value="viridis">Viridis Spectrum</option>
            <option value="heatmap">Thermal Heatmap</option>
            <option value="grayscale">Grayscale</option>
          </select>
        </div>

        <div className="control-card action-group">
          <button onClick={generateGrid} disabled={!image} className="btn-primary">
            Generate Grid
          </button>
          <button onClick={normalizeGrid} disabled={!grid.length} className="btn-success">
            Normalize
          </button>
          <button onClick={downloadImage} disabled={!isNormalized} className="btn-export">
            Export PNG
          </button>
        </div>
      </section>

      {/* Threshold Slider Bar */}
      {isNormalized && normType === "minmax" && (
        <div className="filter-bar">
          <div className="filter-info">
            <span>Threshold Mask:</span>
            <strong>Values Below {threshold}</strong>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
          />
        </div>
      )}

      {/* Main Workspace Layout */}
      {image && (
        <main className="workspace-layout">
          <div className="image-viewport">
            <div className="canvas-wrapper">
              <img src={image} alt="Raster Layer" />
              {grid.length > 0 && (
                <div
                  className="grid-overlay"
                  style={{
                    gridTemplateRows: `repeat(${rows}, 1fr)`,
                    gridTemplateColumns: `repeat(${cols}, 1fr)`,
                  }}
                >
                  {grid.map((cell) => {
                    const rawMin = Math.min(...grid.map((g) => g.rawVal));
                    const rawMax = Math.max(...grid.map((g) => g.rawVal));
                    const ratio = isNormalized 
                      ? cell.normVal 
                      : (cell.rawVal - rawMin) / (rawMax - rawMin || 1);
                    
                    if (isNormalized && normType === "minmax" && cell.normVal < threshold) {
                      return <div key={`${cell.row}-${cell.col}`} className="cell masked">MASKED</div>;
                    }

                    const displayValue = isNormalized ? cell.normVal : Math.round(cell.rawVal);
                    const { bg, isDark } = getCellColor(ratio);

                    return (
                      <div
                        key={`${cell.row}-${cell.col}`}
                        className={`cell ${selectedCell?.row === cell.row && selectedCell?.col === cell.col ? "selected" : ""}`}
                        style={{ backgroundColor: bg, color: isDark ? "#ffffff" : "#0f172a" }}
                        onClick={() => setSelectedCell(cell)}
                      >
                        {displayValue}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Sidebar Inspector Panel */}
          <aside className="side-inspector">
            <div className="panel-card">
              <div className="card-header">
                <h4>Cell Inspector</h4>
              </div>
              {selectedCell ? (
                <div className="inspector-details">
                  <div className="detail-item">
                    <span>Position</span>
                    <strong>Row {selectedCell.row + 1}, Col {selectedCell.col + 1}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Raw Pixel Intensity</span>
                    <strong>{Math.round(selectedCell.rawVal)}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Normalized Value</span>
                    <strong className="accent-text">{selectedCell.normVal !== null ? selectedCell.normVal : "N/A"}</strong>
                  </div>
                </div>
              ) : (
                <div className="empty-state">Click any cell on the grid to inspect values.</div>
              )}
            </div>

            {/* Distribution Chart Card */}
            {grid.length > 0 && (
              <div className="panel-card">
                <div className="card-header">
                  <h4>Histogram Distribution</h4>
                </div>
                <div className="chart-wrapper">
                  <ResponsiveContainer width="100%" height={170}>
                    <BarChart data={histogramData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                      <XAxis dataKey="range" stroke="#64748b" fontSize={9} tickLine={false} />
                      <YAxis stroke="#64748b" fontSize={9} tickLine={false} />
                      <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '11px' }} />
                      <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]}>
                        {histogramData.map((entry, index) => (
                          <RechartCell key={`cell-${index}`} fill={index % 2 === 0 ? "#3b82f6" : "#60a5fa"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </aside>
        </main>
      )}

      {/* Analytics Dashboard Footer */}
      {statistics && (
        <section className="stats-dashboard">
          <div className="dashboard-title">
            <h3>STATISTICAL METRICS</h3>
            <span className="mode-tag">{isNormalized ? normType.toUpperCase() : "RAW DATA"}</span>
          </div>
          <div className="stats-grid">
            <div className="stat-box"><span>MINIMUM</span><strong>{statistics.min.toFixed(2)}</strong></div>
            <div className="stat-box"><span>MAXIMUM</span><strong>{statistics.max.toFixed(2)}</strong></div>
            <div className="stat-box"><span>MEAN</span><strong>{statistics.mean.toFixed(2)}</strong></div>
            <div className="stat-box"><span>MEDIAN</span><strong>{statistics.median.toFixed(2)}</strong></div>
            <div className="stat-box"><span>STD DEV (σ)</span><strong>{statistics.stdDev.toFixed(2)}</strong></div>
            <div className="stat-box"><span>VARIANCE (σ²)</span><strong>{statistics.variance.toFixed(2)}</strong></div>
          </div>
        </section>
      )}
    </div>
  );
}

export default App;