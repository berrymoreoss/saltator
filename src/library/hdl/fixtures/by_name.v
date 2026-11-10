// yosys: read_verilog -icells {in}; hierarchy -auto-top; proc -norom; flatten; tribuf -logic; opt -keepdc; check; write_json {out}
// HDL-9: cells the command never makes from Verilog (other front ends' RTLIL has them),
// instantiated by name (read_verilog -icells).
module by_name (
    input [15:0] a, input [1:0] s, input [3:0] w, input [3:0] m, input [7:0] n, input [7:0] d,
    input set, input clr, input en,
    output [3:0] bmux, output [15:0] demux, output [3:0] bwmux, output [7:0] dfloor,
    output [7:0] mfloor, output [3:0] sr, output [3:0] lsr
);
  $bmux #(.WIDTH(4), .S_WIDTH(2)) u_bmux (.A(a), .S(s), .Y(bmux));
  $demux #(.WIDTH(4), .S_WIDTH(2)) u_demux (.A(w), .S(s), .Y(demux));
  $bwmux #(.WIDTH(4)) u_bwmux (.A(w), .B(a[3:0]), .S(m), .Y(bwmux));
  $divfloor #(.A_SIGNED(1), .B_SIGNED(1), .A_WIDTH(8), .B_WIDTH(8), .Y_WIDTH(8))
    u_divfloor (.A(n), .B(d), .Y(dfloor));
  $modfloor #(.A_SIGNED(1), .B_SIGNED(1), .A_WIDTH(8), .B_WIDTH(8), .Y_WIDTH(8))
    u_modfloor (.A(n), .B(d), .Y(mfloor));
  $sr #(.WIDTH(4), .SET_POLARITY(1), .CLR_POLARITY(0)) u_sr (.SET({4{set}}), .CLR({4{clr}}), .Q(sr));
  $dlatchsr #(.WIDTH(4), .EN_POLARITY(1), .SET_POLARITY(1), .CLR_POLARITY(1))
    u_dlatchsr (.EN(en), .SET({set, 3'b000}), .CLR({3'b000, clr}), .D(w), .Q(lsr));
endmodule
