// yosys: read_verilog {in}; hierarchy -auto-top; proc -norom; flatten; opt -keepdc; check; write_json {out}
// A tri-state made without tribuf: a $mux with z inputs, refused with the command.
module no_tribuf (input oe, input [3:0] a, output [3:0] y);
  assign y = oe ? a : 4'bz;
endmodule
