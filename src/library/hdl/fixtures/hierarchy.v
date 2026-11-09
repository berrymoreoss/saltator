// yosys: read_verilog {in}; hierarchy -auto-top; proc -norom; opt -keepdc; write_json {out}
// Not flattened: the top module places others, refused with the command.
module inv (input a, output y);
  assign y = ~a;
endmodule
module twice (input a, output y);
  wire m;
  inv u1 (.a(a), .y(m));
  inv u2 (.a(m), .y(y));
endmodule
