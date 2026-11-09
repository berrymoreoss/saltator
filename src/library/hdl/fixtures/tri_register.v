// A 74HC574 in Verilog: an edge-triggered register with 3-state outputs (oe_n), and the same
// with the outputs written in an always block.
module tri_register (input cp, input oe_n, input [3:0] d, output [3:0] q, output reg [3:0] p);
  reg [3:0] r;
  always @(posedge cp) r <= d;
  assign q = oe_n ? 4'bz : r;
  always @* if (oe_n) p = 4'bz; else p = r;
endmodule
