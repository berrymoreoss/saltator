// 74HC74: dual D-type flip-flop with set and reset; positive edge-trigger, as a library part
// written in Verilog (HDL-2).
// Timing: Nexperia 74HC_HCT74 product data sheet, rev. 9 (2 April 2024), table 8, at
// VCC = 4.5 V, CL = 50 pF: delays typ (25 °C) and max (−40 °C to +85 °C); the timing checks'
// limits are the guaranteed minima, given only for −40 °C to +85 °C in this revision. Delays in
// ns, min:typ:max, (rise, fall).

// One flip-flop (n = 1, 2). Set and reset both active give Q = Q̅ = H, and the stored bit is
// unknown until a clock edge, a set or a reset: releasing both at once leaves it unknown, as the
// data sheet warns. Synthesizable Verilog has no asynchronous load of x, so a second flip-flop
// remembers that both were active (`stale`) and the outputs read X while it holds.
module hc74_flip_flop (
    input  CP,
    input  D,
    input  SDn,
    input  RDn,
    output Q,
    output QN
);
  reg  q;
  reg  stale;
  wire both = !SDn && !RDn;
  wire one = SDn ^ RDn;
  always @(posedge CP or negedge SDn or negedge RDn)
    if (!RDn) q <= 1'b0;
    else if (!SDn) q <= 1'b1;
    else q <= D;
  always @(posedge CP or posedge both or posedge one)
    if (both) stale <= 1'b1;
    else if (one) stale <= 1'b0;
    else stale <= 1'b0;
  assign Q  = !SDn ? 1'b1 : stale ? 1'bx : q;
  assign QN = !RDn ? 1'b1 : stale ? 1'bx : !q;
  specify
    // tpd(nCP to nQ, nQN) 17 / 44; tpd(nSD to …) 18 / 50; tpd(nRD to …) 19 / 50.
    (posedge CP => (Q +: D)) = (17:17:44, 17:17:44);
    (posedge CP => (QN -: D)) = (17:17:44, 17:17:44);
    (SDn => Q) = (18:18:50, 18:18:50);
    (SDn => QN) = (18:18:50, 18:18:50);
    (RDn => Q) = (19:19:50, 19:19:50);
    (RDn => QN) = (19:19:50, 19:19:50);
    // tsu(nD to nCP) 15, th(nD to nCP) 3, tW(nCP) 20: while neither set nor reset holds it.
    $setup(D, posedge CP &&& (SDn & RDn), 15);
    $hold(posedge CP &&& (SDn & RDn), D, 3);
    $hold(posedge CP &&& (SDn & RDn), negedge CP, 20);
    $hold(negedge CP &&& (SDn & RDn), posedge CP, 20);
    // tW(nSD, nRD) 20 (LOW pulses), trec(nSD, nRD) 8.
    $hold(negedge SDn, posedge SDn, 20);
    $hold(negedge RDn, posedge RDn, 20);
    $recovery(posedge SDn, posedge CP, 8);
    $recovery(posedge RDn, posedge CP, 8);
  endspecify
endmodule

// The chip: flip-flop n on bit n-1 of each port (pins 1RD … 2Q̅).
module hc74 (
    input  [1:0] CP,
    input  [1:0] D,
    input  [1:0] SDn,
    input  [1:0] RDn,
    output [1:0] Q,
    output [1:0] QN
);
  hc74_flip_flop ff1 (CP[0], D[0], SDn[0], RDn[0], Q[0], QN[0]);
  hc74_flip_flop ff2 (CP[1], D[1], SDn[1], RDn[1], Q[1], QN[1]);
endmodule
