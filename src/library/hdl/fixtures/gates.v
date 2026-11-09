// yosys: read_verilog {in}; synth -top gates; write_json {out}
// A gate-level netlist from synth: refused with the command.
module gates (input clk, input [1:0] a, output reg q);
  always @(posedge clk) q <= a[0] & ~a[1];
endmodule
