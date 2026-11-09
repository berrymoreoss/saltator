// Tri-states inside the module: submodules sharing a bus become logic (tribuf -logic), and
// a merged buffer whose bits reach an output port stays, always enabled.
module drv (input oe, input [3:0] a, output [3:0] y);
  assign y = oe ? a : 4'bz;
endmodule

module tri_internal (input s, input [3:0] a, input [3:0] b, output [3:0] y, output [3:0] n);
  wire [3:0] bus;
  wire [3:0] bus2;
  drv u1 (.oe(s), .a(a), .y(bus));
  drv u2 (.oe(!s), .a(b), .y(bus));
  assign n = ~bus;
  assign bus2 = s ? a : 4'bz;
  assign bus2 = !s ? b : 4'bz;
  assign y = bus2 ^ 4'b0101;
endmodule
