// A hierarchy flattened by the command: one module, the inner instances gone.
module inv (input a, output y);
  assign y = ~a;
endmodule
module twice (input a, output y);
  wire m;
  inv u1 (.a(a), .y(m));
  inv u2 (.a(m), .y(y));
endmodule
