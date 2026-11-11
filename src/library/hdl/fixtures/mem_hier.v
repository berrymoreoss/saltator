// A memory inside a submodule: flattened, it is named u_store.mem.
module store (input clk, we, input [1:0] a, input [7:0] d, output [7:0] q);
  reg [7:0] mem[0:3];
  always @(posedge clk) if (we) mem[a] <= d;
  assign q = mem[a];
endmodule

module mem_hier (input clk, we, input [1:0] a, input [7:0] d, output [7:0] q);
  store u_store (.clk(clk), .we(we), .a(a), .d(d), .q(q));
endmodule
