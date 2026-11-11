// 74HC574: octal D-type flip-flop; positive edge-trigger; 3-state, as a library part written in
// Verilog (HDL-2).
// Timing: Nexperia 74HC_HCT574 product data sheet, rev. 10 (5 August 2024), table 7, at
// VCC = 4.5 V, CL = 50 pF: delays typ (25 °C) and max (−40 °C to +85 °C); the timing checks'
// limits are the guaranteed minima at 25 °C. Delays in ns, min:typ:max, (rise, fall).
module hc574 (
    input        CP,
    input        OEn,
    input  [7:0] D,
    output [7:0] Q
);
  reg [7:0] r;
  always @(posedge CP) r <= D;
  // The register loads while the outputs are disabled.
  assign Q = OEn ? 8'bz : r;
  specify
    // tpd(CP to Qn) 17 / 35.
    (posedge CP *> (Q +: D)) = (17:17:35, 17:17:35);
    // Yosys keeps only rise and fall of a path, so enabling (ten 16 / 35) and disabling
    // (tdis 14 / 31) are two paths from OE, conditional on its level after the change.
    if (!OEn) (OEn *> Q) = (16:16:35, 16:16:35);
    if (OEn) (OEn *> Q) = (14:14:31, 14:14:31);
    // tsu(Dn to CP) 12, th(Dn to CP) 5, tW(CP) 16 (both phases).
    $setup(D, posedge CP, 12);
    $hold(posedge CP, D, 5);
    $hold(posedge CP, negedge CP, 16);
    $hold(negedge CP, posedge CP, 16);
  endspecify
endmodule
