// An ascending vector port: its bit order differs from the app's buses, so it is refused.
module ascending (input [0:3] a, output y);
  assign y = ^a;
endmodule
